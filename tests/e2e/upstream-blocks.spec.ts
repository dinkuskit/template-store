import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const proofRoot = resolve("runs/upstream-blocks-20260926/browser");
const headers = { "X-EmDash-Request": "1" };
const missingNativeType = "missing_local_renderer";
const originalAllowedTypes = ["home_opener", "rich_text", "query_card"];

async function welcome(admin: Page): Promise<void> {
  const dialog = admin.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await admin.getByRole("button", { name: "Get Started" }).click({ timeout: 30_000 });
  } catch {
    await expect(dialog).toHaveCount(0);
  }
  await expect(dialog).toHaveCount(0);
}

async function publishHome(admin: Page): Promise<void> {
  const published = admin.getByRole("button", { name: "Publish changes", exact: true });
  await expect(published).toBeEnabled();
  await published.click();
  await admin.getByRole("dialog", { name: "Publish changes?" }).getByRole("button", { name: "Publish changes", exact: true }).click();
}

async function saveAndPublish(
  admin: Page,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const saved = await admin.request.put(`/_emdash/api/content/pages/${id}?locale=en`, {
    headers, data: { data },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const published = await admin.request.post(`/_emdash/api/content/pages/${id}/publish?locale=en`, { headers });
  expect(published.ok(), await published.text()).toBe(true);
  return (await (await admin.request.get(`/_emdash/api/content/pages/${id}`)).json()).data.item.data as Record<string, unknown>;
}

async function allowMissingNativeType(admin: Page): Promise<void> {
  const created = await admin.request.post("/_emdash/api/schema/block-types", {
    headers,
    data: {
      slug: missingNativeType,
      label: "Missing local renderer",
      category: "Proof",
      fields: [{ slug: "title", label: "Title", type: "string" }],
    },
  });
  if (![200, 201].includes(created.status())) {
    const body = await created.json() as { error?: { code?: string } };
    expect(body.error?.code, JSON.stringify(body)).toBe("BLOCK_TYPE_EXISTS");
  }
  const pages = await admin.request.get("/_emdash/api/schema/collections/pages?includeFields=true");
  expect(pages.ok(), await pages.text()).toBe(true);
  const fields = (await pages.json()).data.item.fields as Array<{ slug: string; validation?: Record<string, unknown> }>;
  const layout = fields.find((field) => field.slug === "layout");
  expect(layout, "pages.layout must exist before an unknown native type can be allowed").toBeTruthy();
  const updated = await admin.request.put("/_emdash/api/schema/collections/pages/fields/layout", {
    headers,
    data: {
      validation: {
        ...(layout?.validation ?? {}),
        allowedTypes: [...originalAllowedTypes, missingNativeType],
        maxItems: 50,
      },
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
}

async function restoreAllowedTypes(request: APIRequestContext): Promise<void> {
  const pages = await request.get("/_emdash/api/schema/collections/pages?includeFields=true", { headers });
  if (!pages.ok()) return;
  const fields = (await pages.json()).data.item.fields as Array<{ slug: string; validation?: Record<string, unknown> }>;
  const layout = fields.find((field) => field.slug === "layout");
  if (!layout) return;
  await request.put("/_emdash/api/schema/collections/pages/fields/layout", {
    headers,
    data: {
      validation: {
        ...(layout.validation ?? {}),
        allowedTypes: originalAllowedTypes,
        maxItems: 50,
      },
    },
  });
}

async function regenerateEnvTypes(request: APIRequestContext, fallback: string): Promise<void> {
  const typegen = await request.post("/_emdash/api/typegen", { headers });
  if (!typegen.ok()) {
    await writeFile(resolve("emdash-env.d.ts"), fallback);
    return;
  }
  const body = await typegen.json() as { data?: { types?: string } };
  const types = body.data?.types;
  if (typeof types === "string" && !/block_notices_|empty_block_notices_|missing_local_renderer/u.test(types)) {
    await writeFile(resolve("emdash-env.d.ts"), types.endsWith("\n") ? types : `${types}\n`);
    return;
  }
  await writeFile(resolve("emdash-env.d.ts"), fallback);
}

function sqlite(database: string, query: string): string {
  return execFileSync("sqlite3", [database, query], { encoding: "utf8" }).trim();
}

function columnNames(database: string, table: string): string[] {
  return sqlite(database, `PRAGMA table_info(${table});`)
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("|")[1] ?? "")
    .filter(Boolean);
}

test("first-class page blocks preserve the Portable Text rollback and render a bounded published query", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const evidence = resolve(proofRoot, testInfo.project.name);
  await mkdir(evidence, { recursive: true });
  const originalEnvTypes = await readFile(resolve("emdash-env.d.ts"), "utf8");
  expect(originalEnvTypes).not.toMatch(/block_notices_|empty_block_notices_/u);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const context = await browser.newContext();
  const admin = await context.newPage();
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/pages/home");
  await expect(admin).toHaveURL(/\/_emdash\/admin\/content\/pages\/home/);
  await welcome(admin);

  const current = await admin.request.get("/_emdash/api/content/pages/home");
  expect(current.ok(), await current.text()).toBe(true);
  const item = (await current.json()).data.item as { id: string; data: Record<string, unknown> };
  const original = structuredClone(item.data);
  const originalContent = original.content;
  const orphanFactRail = {
    _type: "dinkus.fact-rail",
    _key: "standalone-facts",
    facts: [{ _key: "fact", label: "Hours", value: "Open" }],
  };
  const orphanPreview = execFileSync(process.execPath, [resolve("scripts/migrate-home-layout.mjs")], {
    input: JSON.stringify({ data: { item: { id: "standalone-facts-home", data: { content: [orphanFactRail] } } } }),
    encoding: "utf8",
  });
  const orphanLayout = (JSON.parse(orphanPreview) as { layout: Array<Record<string, unknown>> }).layout;
  expect(orphanLayout).toEqual([
    { _type: "rich_text", _version: 1, _key: "legacy-rich-0", content: [orphanFactRail] },
  ]);
  expect(() => execFileSync(
    process.execPath,
    [resolve("scripts/migrate-home-layout.mjs"), "--apply", "--base-url=https://example.invalid"],
    { encoding: "utf8", env: {} },
  )).toThrow(/loopback HTTP base URL|loopback URLs/u);
  const originalLayout = original.layout as Array<Record<string, unknown>>;
  expect(Array.isArray(originalContent)).toBe(true);
  const legacyHero = (originalContent as Array<Record<string, unknown>>).find((block) => block._type === "dinkus.page-hero");
  expect(legacyHero).toMatchObject({ primaryLabel: "Shop the collection", primaryHref: "#commerce-catalog", secondaryLabel: "View products", secondaryHref: "#commerce-catalog" });
  expect(originalLayout[0]?._type).toBe("home_opener");
  const originalFactRails = (originalContent as Array<Record<string, unknown>>).filter((block) => block._type === "dinkus.fact-rail");
  expect(originalFactRails).toHaveLength(1);

  const duplicateButton = admin.getByRole("button", { name: "Duplicate block" });
  await expect(duplicateButton).toHaveCount(1);
  await duplicateButton.click();
  const copiedBlock = admin.locator("[data-block-key]").nth(1);
  const copiedHeadline = copiedBlock.getByRole("textbox", { name: "Headline" });
  await expect(copiedHeadline).toHaveValue("Everyday essentials, clearly presented");
  await copiedHeadline.fill("A separately edited opener copy");
  const changes = admin.getByRole("button", { name: "Publish changes" });
  await expect(changes).toBeEnabled();
  const publishResponse = admin.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/content/pages/") && response.url().includes("/publish"));
  await changes.click();
  const confirmation = admin.getByRole("dialog", { name: "Publish changes?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Publish changes", exact: true }).click();
  expect((await publishResponse).ok()).toBe(true);
  const copied = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
  const copiedLayout = copied.layout as Array<Record<string, unknown>>;
  expect(copiedLayout).toHaveLength(2);
  expect(copiedLayout[0].headline).toBe("Everyday essentials, clearly presented");
  expect(copiedLayout[1].headline).toBe("A separately edited opener copy");
  expect(copiedLayout[0]._key).not.toBe(copiedLayout[1]._key);
  await page.goto("/");
  await expect(page.locator('[data-layout="blocks"] [data-home-opener] h1')).toHaveText("Everyday essentials, clearly presented");
  await expect(page.locator('[data-layout="blocks"] [data-home-opener] h2')).toHaveText("A separately edited opener copy");
  await page.screenshot({ path: resolve(evidence, "public-seeded-blocks.png"), fullPage: true, animations: "disabled" });

  const collection = `block_notices_${testInfo.project.name === "chromium-mobile" ? "m" : "d"}`;
  const emptyCollection = `empty_block_notices_${testInfo.project.name === "chromium-mobile" ? "m" : "d"}`;
  const createdCollection = await admin.request.post("/_emdash/api/schema/collections", {
    headers, data: { slug: collection, label: "Block notices", labelSingular: "Block notice", supports: ["drafts", "revisions"] },
  });
  expect(createdCollection.status(), await createdCollection.text()).toBe(201);
  const createdEmptyCollection = await admin.request.post("/_emdash/api/schema/collections", {
    headers, data: { slug: emptyCollection, label: "Empty block notices", labelSingular: "Empty block notice", supports: ["drafts", "revisions"] },
  });
  expect(createdEmptyCollection.status(), await createdEmptyCollection.text()).toBe(201);
  for (const slug of ["title", "text", "image", "link"]) {
    const field = await admin.request.post(`/_emdash/api/schema/collections/${collection}/fields`, {
      headers, data: { slug, label: slug, type: "string", validation: null, options: {} },
    });
    expect(field.status(), await field.text()).toBe(201);
  }
  async function addRecord(
    slug: string,
    title: string,
    publish: boolean,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await admin.request.post(`/_emdash/api/content/${collection}`, {
      headers, data: { slug, status: "draft", data: { title, text: "Current published editorial content.", image: "/merch/cap.svg", link: "/products/canvas-cap", ...overrides } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).data.item.id as string;
    if (publish) {
      const published = await admin.request.post(`/_emdash/api/content/${collection}/${id}/publish`, { headers });
      expect(published.ok(), await published.text()).toBe(true);
    }
    return id;
  }

  let rootError: unknown;
  try {
    await addRecord("one", "First block notice", true);
    await addRecord("draft", "Draft block notice", false);

    const originalLegacyPublished = await saveAndPublish(admin, item.id, { ...original, layout: [] });
    expect(originalLegacyPublished.content).toEqual(originalContent);
    expect(originalLegacyPublished.layout).toEqual([]);

    const nativeRestored = await saveAndPublish(admin, item.id, { ...original, layout: copiedLayout });
    expect(nativeRestored.content).toEqual(originalContent);
    expect(nativeRestored.layout).toEqual(copiedLayout);
    await admin.goto("/_emdash/admin/content/pages/home");
    const addBlock = admin.getByRole("button", { name: "Add block", exact: true });
    await expect(addBlock).toBeVisible();
    await addBlock.click();
    await admin.getByRole("textbox", { name: "Search block types" }).fill("Query card");
    await admin.getByRole("button", { name: /Query card/u }).last().click();
    const queryEditor = admin.locator("[data-block-key]").filter({ hasText: "Query card" }).last();
    await expect(queryEditor).toBeVisible();
    await queryEditor.getByRole("textbox", { name: /Source collection slug/u }).fill(collection);
    const limit = queryEditor.getByRole("spinbutton", { name: /Maximum published records/u });
    await expect(limit).toBeVisible();
    await limit.fill("2");
    await publishHome(admin);
    await expect(admin.getByText(collection, { exact: true })).toBeVisible();
    await limit.fill("1");
    await publishHome(admin);
    await expect(admin.getByText(collection, { exact: true })).toBeVisible();
    await admin.screenshot({ path: resolve(evidence, "admin-layout-block-cards.png"), fullPage: true, animations: "disabled" });

    await page.goto("/");
    const cards = page.locator("[data-dinkus-block=query-card]");
    await expect(cards.locator("article")).toHaveCount(1);
    await expect(cards.getByRole("link", { name: "First block notice" })).toHaveAttribute("href", "/products/canvas-cap");
    await expect(cards.getByText("Draft block notice", { exact: true })).toHaveCount(0);
    await expect(cards.locator("img")).toHaveAttribute("src", "/merch/cap.svg");
    await expect(cards.locator('a[href^="javascript:"]')).toHaveCount(0);
    await page.screenshot({ path: resolve(evidence, "public-query-card.png"), fullPage: true, animations: "disabled" });

    await allowMissingNativeType(admin);
    const nestedQuery = { _type: "dinkus.query-card", _key: "nested-query", source: collection, limit: 1 };
    const nestedFacts = { _type: "dinkus.fact-rail", _key: "nested-facts", facts: [{ label: "Nested", value: "Preserved" }] };
    const unknownPortableText = { _type: "dinkus.future-editorial-node", _key: "legacy-unknown", label: "retained raw node" };
    const richTextLayout = [{
      _type: missingNativeType,
      _version: 1,
      _key: "native-unknown",
      title: "retained native block",
    }, {
      _type: "rich_text",
      _version: 1,
      _key: "legacy-rich-text-proof",
      content: [nestedQuery, nestedFacts, unknownPortableText],
    }];
    const richTextHome = await saveAndPublish(admin, item.id, { ...original, content: originalContent, layout: richTextLayout });
    expect(richTextHome.content).toEqual(originalContent);
    expect(richTextHome.layout).toEqual(richTextLayout);
    await page.goto("/");
    await expect(page.locator(`[data-layout="blocks"] [data-emdash-missing-block="${missingNativeType}"]`)).toHaveCount(1);
    await expect(page.locator('[data-layout="blocks"] .layout-rich-text .dinkus-fact-rail')).toHaveCount(1);
    await expect(page.locator('[data-layout="blocks"] .layout-rich-text [data-dinkus-block="query-card"] article')).toHaveCount(1);
    await expect(page.locator('[data-layout="blocks"] .layout-rich-text [data-emdash-unsupported-content="dinkus.future-editorial-node"]')).toHaveCount(1);

    await addRecord("unsafe", "Unsafe block notice", true, { image: "javascript:alert(1)", link: "javascript:alert(1)" });
    const legacyQuery = { _type: "dinkus.query-card", _key: "legacy-query", source: collection, limit: 2 };
    const standaloneFacts = { _type: "dinkus.fact-rail", _key: "reordered-facts", facts: [{ label: "Standalone", value: "Preserved" }] };
    const legacyWithQuery = [
      ...(originalContent as Array<Record<string, unknown>>),
      legacyQuery,
      standaloneFacts,
      unknownPortableText,
    ];
    const legacyQueryHome = await saveAndPublish(admin, item.id, { ...original, content: legacyWithQuery, layout: [] });
    const retainedLegacyQuery = (legacyQueryHome.content as Array<Record<string, unknown>>).find((block) => block._key === "legacy-query");
    expect(retainedLegacyQuery).toMatchObject({ source: collection, limit: 2 });
    await page.goto("/");
    const legacyCards = page.locator('[data-layout="portable-text"] [data-dinkus-block="query-card"]');
    await expect(legacyCards.locator("article")).toHaveCount(2);
    await expect(legacyCards.getByText("Unsafe block notice", { exact: true })).toBeVisible();
    await expect(legacyCards.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(legacyCards.locator('img[src^="javascript:"]')).toHaveCount(0);
    await expect(legacyCards.getByText("Draft block notice", { exact: true })).toHaveCount(0);

    const emptyQuery = { ...legacyQuery, source: emptyCollection, limit: 1 };
    const emptyContent = [
      ...(originalContent as Array<Record<string, unknown>>),
      emptyQuery,
      standaloneFacts,
      unknownPortableText,
    ];
    const emptyHome = await saveAndPublish(admin, item.id, { ...original, content: emptyContent, layout: [] });
    expect((emptyHome.content as Array<Record<string, unknown>>).find((block) => block._key === "legacy-query")).toMatchObject({
      source: emptyCollection,
      limit: 1,
    });
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] [data-dinkus-block="query-card"]')).toHaveCount(0);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);

    const missingQuery = { ...legacyQuery, source: "missing_collection", limit: 1 };
    const missingContent = [
      ...(originalContent as Array<Record<string, unknown>>),
      missingQuery,
      standaloneFacts,
      unknownPortableText,
    ];
    const missingHome = await saveAndPublish(admin, item.id, { ...original, content: missingContent, layout: [] });
    expect((missingHome.content as Array<Record<string, unknown>>).find((block) => block._key === "legacy-query")).toMatchObject({
      source: "missing_collection",
      limit: 1,
    });
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] [data-dinkus-block="query-card"]')).toHaveCount(0);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);

    const nativeBeforeEdit = await saveAndPublish(admin, item.id, { ...original, layout: copiedLayout });
    expect(nativeBeforeEdit.content).toEqual(originalContent);
    expect((nativeBeforeEdit.layout as Array<Record<string, unknown>>)[0]?._type).toBe("home_opener");
    await context.addCookies([{ name: "emdash-edit-mode", value: "true", url: testInfo.project.use.baseURL as string }]);
    await admin.goto("/");
    await expect(admin.locator("[data-home-opener] h1")).toHaveText("Everyday essentials, clearly presented");
    await expect(admin.getByRole("checkbox", { name: "Edit mode" })).toBeChecked();
    await expect(admin.getByRole("button", { name: "Hide toolbar" })).toBeVisible();
    await admin.screenshot({ path: resolve(evidence, "public-authenticated-edit-mode.png"), fullPage: true, animations: "disabled" });

    const fallbackHome = await saveAndPublish(admin, item.id, { ...original, content: legacyWithQuery, layout: [] });
    expect((fallbackHome.content as Array<Record<string, unknown>>).filter((block) => block._type === "dinkus.fact-rail")).toHaveLength(2);
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-fact-rail')).toHaveCount(2);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-query-card article')).toHaveCount(2);
    await expect(page.locator('[data-layout="portable-text"] [data-emdash-unsupported-content="dinkus.future-editorial-node"]')).toHaveCount(1);
    await page.screenshot({ path: resolve(evidence, "public-legacy-fallback.png"), fullPage: true, animations: "disabled" });

    const revisions = await admin.request.get(`/_emdash/api/content/pages/${item.id}/revisions?limit=50`);
    expect(revisions.ok()).toBe(true);
    const history = (await revisions.json()).data.items as Array<{ id: string; data?: Record<string, unknown> }>;
    const blockRevision = history.find((revision) => Array.isArray(revision.data?.layout) && JSON.stringify(revision.data.layout).includes("query_card"));
    const originalLegacyRevision = history.find((revision) => {
      const layout = revision.data?.layout;
      return JSON.stringify(revision.data?.content) === JSON.stringify(originalContent)
        && Array.isArray(layout)
        && layout.length === 0;
    });
    expect(blockRevision, "published first-class blocks must remain available in revision history").toBeTruthy();
    expect(originalLegacyRevision, "the exact original Portable Text revision must remain restorable").toBeTruthy();
    const restoredRevision = await admin.request.post(`/_emdash/api/revisions/${originalLegacyRevision!.id}/restore`, { headers });
    expect(restoredRevision.ok(), await restoredRevision.text()).toBe(true);
    const restoredLegacy = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(restoredLegacy.ok(), await restoredLegacy.text()).toBe(true);
    const restoredHome = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
    expect(restoredHome.layout).toEqual([]);
    expect(restoredHome.content).toEqual(originalContent);
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-fact-rail')).toHaveCount(1);
    await expect(page.locator('[data-layout="portable-text"] [data-dinkus-block="query-card"]')).toHaveCount(0);

    const migrationResponse = await admin.request.get(`/_emdash/api/content/pages/${item.id}`);
    expect(migrationResponse.ok()).toBe(true);
    const migrationInput = await migrationResponse.text();
    const migrationPreview = execFileSync(process.execPath, [resolve("scripts/migrate-home-layout.mjs")], { input: migrationInput, encoding: "utf8" });
    expect(JSON.parse(migrationPreview).action).toBe("preview only");
    const cookies = await context.cookies(testInfo.project.use.baseURL as string);
    const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    const snapshotRoot = resolve(".artifacts/e2e/migration-snapshots", `${testInfo.project.name}-${process.pid}-${Date.now()}`);
    const backupPath = resolve(snapshotRoot, "pre-apply.db");
    const refusalPath = resolve(snapshotRoot, "existing-snapshot.db");
    const migrationArgs = [resolve("scripts/migrate-home-layout.mjs"), "--apply", `--base-url=${testInfo.project.use.baseURL as string}`];
    await mkdir(snapshotRoot, { recursive: true });
    await copyFile(resolve(".artifacts/e2e/content.db"), refusalPath);
    expect(() => execFileSync(
      process.execPath,
      migrationArgs,
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DINKUS_EMDASH_SESSION_COOKIE: cookieHeader,
          DINKUS_EMDASH_MIGRATION_CONFIRM: `apply:${item.id}`,
          DINKUS_EMDASH_DB_PATH: resolve(".artifacts/e2e/content.db"),
          DINKUS_EMDASH_BACKUP_PATH: refusalPath,
        },
      },
    )).toThrow(/Refusing to overwrite existing backup snapshot/u);
    const migrationEnv = {
      ...process.env,
      DINKUS_EMDASH_SESSION_COOKIE: cookieHeader,
      DINKUS_EMDASH_MIGRATION_CONFIRM: `apply:${item.id}`,
      DINKUS_EMDASH_DB_PATH: resolve(".artifacts/e2e/content.db"),
      DINKUS_EMDASH_BACKUP_PATH: backupPath,
    };
    const migrationApplied = execFileSync(process.execPath, migrationArgs, { encoding: "utf8", env: migrationEnv });
    expect(JSON.parse(migrationApplied).action).toBe("applied");
    const restoredDatabase = resolve(snapshotRoot, "restored-copy.db");
    await copyFile(backupPath, restoredDatabase);
    const pageColumns = columnNames(restoredDatabase, "ec_pages");
    expect(pageColumns).toEqual(expect.arrayContaining(["id", "content", "layout"]));
    const revisionColumns = columnNames(restoredDatabase, "revisions");
    expect(revisionColumns).toEqual(expect.arrayContaining(["id", "collection", "entry_id", "data"]));
    const escapedId = item.id.replaceAll("'", "''");
    expect(sqlite(restoredDatabase, `SELECT json_array_length(layout) FROM ec_pages WHERE id = '${escapedId}';`)).toBe("0");
    const restoredContent = JSON.parse(sqlite(restoredDatabase, `SELECT content FROM ec_pages WHERE id = '${escapedId}';`));
    expect(restoredContent).toEqual(originalContent);
    expect(restoredContent.some((block: { _type?: string }) => block._type === "dinkus.page-hero")).toBe(true);
    const revisionCount = Number(sqlite(
      restoredDatabase,
      `SELECT count(*) FROM revisions WHERE collection = 'pages' AND entry_id = '${escapedId}';`,
    ));
    expect(revisionCount).toBeGreaterThan(0);
    expect(sqlite(restoredDatabase, "PRAGMA integrity_check;")).toBe("ok");
    const migrationRepeated = execFileSync(process.execPath, migrationArgs, { encoding: "utf8", env: migrationEnv });
    expect(JSON.parse(migrationRepeated).action).toBe("skip");
    const migrationPublished = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(migrationPublished.ok(), await migrationPublished.text()).toBe(true);
    const migrated = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
    expect(migrated.content).toEqual(originalContent);
    const migratedLayout = migrated.layout as Array<Record<string, unknown>>;
    expect(migratedLayout[0]?._type).toBe("home_opener");
    expect(migratedLayout[0]).toMatchObject({ primary_label: "Shop the collection", primary_href: "#commerce-catalog", secondary_label: "View products", secondary_href: "#commerce-catalog" });
    await page.goto("/");
    await expect(page.locator('[data-layout="blocks"] [data-home-opener] h1')).toHaveText("Everyday essentials, clearly presented");
    await expect(page.locator(".home-opener__primary")).toHaveAttribute("href", "#commerce-catalog");
    await expect(page.locator('.home-opener__actions a[href="#commerce-catalog"]')).toHaveText(["Shop the collection", "View products"]);

    await writeFile(resolve(evidence, "revision-assertions.json"), JSON.stringify({
      revisionRetainedBlocks: true,
      legacyContentRetainedDuringBlocksEdit: JSON.stringify(originalContent) === JSON.stringify(original.content),
      legacyFallbackAfterLayoutRemoval: true,
      publicEditMode: "authenticated Edit-mode toolbar and rendered first-class block; editing remains in admin",
      independentHomeOpenerCopy: true,
      legacyRevisionRestored: true,
      originalLegacyContentRestored: true,
      migrationPreviewNoWrite: true,
      migrationBackupIntegrity: true,
      migrationBackupSha256: JSON.parse(migrationApplied).backup.sha256,
      migrationBackupRestoreVerified: true,
      migrationApplyPreservesContent: true,
      migrationRerunSkipped: true,
      queryLimit: 1,
      draftExcluded: true,
      safeLinkRendered: true,
      emptyQueryRetainedSource: true,
      missingQueryRetainedSource: true,
      standaloneFactRails: 2,
      registeredMissingNativeType: missingNativeType,
    }, null, 2) + "\n");
  } catch (error) {
    rootError = error;
    throw error;
  } finally {
    try {
      const restored = await admin.request.put(`/_emdash/api/content/pages/${item.id}?locale=en`, { headers, data: { data: original } });
      if (!restored.ok()) throw new Error(`fixture restore failed: ${await restored.text()}`);
      const republished = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
      if (!republished.ok()) throw new Error(`fixture republish failed: ${await republished.text()}`);
      const removedCollection = await admin.request.delete(`/_emdash/api/schema/collections/${collection}?force=true`, { headers });
      if (!removedCollection.ok()) throw new Error(`collection cleanup failed: ${await removedCollection.text()}`);
      const removedEmptyCollection = await admin.request.delete(`/_emdash/api/schema/collections/${emptyCollection}?force=true`, { headers });
      if (!removedEmptyCollection.ok()) throw new Error(`empty collection cleanup failed: ${await removedEmptyCollection.text()}`);
      await restoreAllowedTypes(admin.request);
      await new Promise((resolveWait) => setTimeout(resolveWait, 700));
      await regenerateEnvTypes(admin.request, originalEnvTypes);
      await new Promise((resolveWait) => setTimeout(resolveWait, 700));
      const afterTypegen = await readFile(resolve("emdash-env.d.ts"), "utf8");
      if (/block_notices_|empty_block_notices_|missing_local_renderer/u.test(afterTypegen)) {
        await writeFile(resolve("emdash-env.d.ts"), originalEnvTypes);
      }
    } catch (cleanupError) {
      if (!rootError) throw cleanupError;
    } finally {
      await context.close();
    }
  }
});
