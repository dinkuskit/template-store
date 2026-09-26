import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/upstream-blocks-20260926/browser");
const headers = { "X-EmDash-Request": "1" };

async function welcome(admin: import("@playwright/test").Page): Promise<void> {
  const dialog = admin.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await admin.getByRole("button", { name: "Get Started" }).click({ timeout: 30_000 });
  } catch {
    await expect(dialog).toHaveCount(0);
  }
  await expect(dialog).toHaveCount(0);
}

test("first-class page blocks preserve the Portable Text rollback and render a bounded published query", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const evidence = resolve(proofRoot, testInfo.project.name);
  await mkdir(evidence, { recursive: true });
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
  expect(legacyHero).toMatchObject({ primaryLabel: "Shop the collection", primaryHref: "#catalog-title", secondaryLabel: "See availability proof", secondaryHref: "#managed-product" });
  expect(originalLayout[0]?._type).toBe("home_opener");

  const duplicateButton = admin.getByRole("button", { name: "Duplicate block" });
  await expect(duplicateButton).toHaveCount(1);
  await duplicateButton.click();
  const copiedBlock = admin.locator("[data-block-key]").nth(1);
  const copiedHeadline = copiedBlock.locator("label", { hasText: "Headline" }).locator("xpath=following-sibling::input[1]");
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
  const createdCollection = await admin.request.post("/_emdash/api/schema/collections", {
    headers, data: { slug: collection, label: "Block notices", labelSingular: "Block notice", supports: ["drafts", "revisions"] },
  });
  expect(createdCollection.status(), await createdCollection.text()).toBe(201);
  for (const slug of ["title", "text", "image", "link"]) {
    const field = await admin.request.post(`/_emdash/api/schema/collections/${collection}/fields`, {
      headers, data: { slug, label: slug, type: "string", validation: null, options: {} },
    });
    expect(field.status(), await field.text()).toBe(201);
  }
  async function addRecord(slug: string, title: string, publish: boolean): Promise<void> {
    const created = await admin.request.post(`/_emdash/api/content/${collection}`, {
      headers, data: { slug, status: "draft", data: { title, text: "Current published editorial content.", image: "/merch/cap.svg", link: "/products/canvas-cap" } },
    });
    expect(created.status(), await created.text()).toBe(201);
    if (publish) {
      const id = (await created.json()).data.item.id as string;
      const published = await admin.request.post(`/_emdash/api/content/${collection}/${id}/publish`, { headers });
      expect(published.ok(), await published.text()).toBe(true);
    }
  }
  try {
    await addRecord("one", "First block notice", true);
    await addRecord("draft", "Draft block notice", false);
    const layout = [...copiedLayout, { _type: "query_card", _version: 1, _key: `query-${collection}`, source: collection, limit: 1 }];
    const saved = await admin.request.put(`/_emdash/api/content/pages/${item.id}?locale=en`, {
      headers, data: { data: { ...original, layout } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const savedHome = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
    expect(savedHome.content).toEqual(originalContent);
    expect(savedHome.layout).toEqual(layout);
    const published = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(published.ok(), await published.text()).toBe(true);

    await admin.goto("/_emdash/admin/content/pages/home");
    await expect(admin.getByText("Query card", { exact: true })).toBeVisible();
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

    await context.addCookies([{ name: "emdash-edit-mode", value: "true", url: testInfo.project.use.baseURL as string }]);
    await admin.goto("/");
    await expect(admin.locator("[data-home-opener] h1")).toHaveText("Everyday essentials, clearly presented");
    await expect(admin.getByRole("checkbox", { name: "Edit mode" })).toBeChecked();
    await expect(admin.getByRole("button", { name: "Hide toolbar" })).toBeVisible();
    await admin.screenshot({ path: resolve(evidence, "public-authenticated-edit-mode.png"), fullPage: true, animations: "disabled" });

    const withoutLayout = { ...original, layout: [] };
    const legacyDraft = await admin.request.put(`/_emdash/api/content/pages/${item.id}?locale=en`, { headers, data: { data: withoutLayout } });
    expect(legacyDraft.ok(), await legacyDraft.text()).toBe(true);
    const legacyPublished = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(legacyPublished.ok(), await legacyPublished.text()).toBe(true);
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);
    await expect(page.locator('[data-layout="portable-text"] .dinkus-fact-rail')).toHaveCount(1);
    await page.screenshot({ path: resolve(evidence, "public-legacy-fallback.png"), fullPage: true, animations: "disabled" });

    const revisions = await admin.request.get(`/_emdash/api/content/pages/${item.id}/revisions?limit=20`);
    expect(revisions.ok()).toBe(true);
    const history = (await revisions.json()).data.items as Array<{ id: string; data?: Record<string, unknown> }>;
    const blockRevision = history.find((revision) => Array.isArray(revision.data?.layout) && JSON.stringify(revision.data.layout).includes("query_card"));
    const legacyRevision = history.find((revision) => (!Array.isArray(revision.data?.layout) || revision.data.layout.length === 0) && Array.isArray(revision.data?.content));
    expect(blockRevision, "published first-class blocks must remain available in revision history").toBeTruthy();
    expect(legacyRevision, "the pre-layout Portable Text revision must remain restorable").toBeTruthy();
    const restoredRevision = await admin.request.post(`/_emdash/api/revisions/${legacyRevision!.id}/restore`, { headers });
    expect(restoredRevision.ok(), await restoredRevision.text()).toBe(true);
    const restoredLegacy = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(restoredLegacy.ok(), await restoredLegacy.text()).toBe(true);
    const restoredHome = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
    expect(restoredHome.layout).toEqual([]);
    await page.goto("/");
    await expect(page.locator('[data-layout="portable-text"] .dinkus-page-hero')).toHaveCount(1);

    const migrationResponse = await admin.request.get(`/_emdash/api/content/pages/${item.id}`);
    expect(migrationResponse.ok()).toBe(true);
    const migrationInput = await migrationResponse.text();
    const migrationPreview = execFileSync(process.execPath, [resolve("scripts/migrate-home-layout.mjs")], { input: migrationInput, encoding: "utf8" });
    expect(JSON.parse(migrationPreview).action).toBe("preview only");
    const cookies = await context.cookies(testInfo.project.use.baseURL as string);
    const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    const migrationEnv = {
      ...process.env,
      DINKUS_EMDASH_SESSION_COOKIE: cookieHeader,
      DINKUS_EMDASH_MIGRATION_CONFIRM: `apply:${item.id}`,
    };
    const migrationArgs = [resolve("scripts/migrate-home-layout.mjs"), "--apply", `--base-url=${testInfo.project.use.baseURL as string}`];
    const migrationApplied = execFileSync(process.execPath, migrationArgs, { encoding: "utf8", env: migrationEnv });
    expect(JSON.parse(migrationApplied).action).toBe("applied");
    const migrationRepeated = execFileSync(process.execPath, migrationArgs, { encoding: "utf8", env: migrationEnv });
    expect(JSON.parse(migrationRepeated).action).toBe("skip");
    const migrationPublished = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(migrationPublished.ok(), await migrationPublished.text()).toBe(true);
    const migrated = (await (await admin.request.get(`/_emdash/api/content/pages/${item.id}`)).json()).data.item.data as Record<string, unknown>;
    expect(migrated.content).toEqual(originalContent);
    const migratedLayout = migrated.layout as Array<Record<string, unknown>>;
    expect(migratedLayout[0]?._type).toBe("home_opener");
    expect(migratedLayout[0]).toMatchObject({ primary_label: "Shop the collection", primary_href: "#catalog-title", secondary_label: "See availability proof", secondary_href: "#managed-product" });
    await page.goto("/");
    await expect(page.locator('[data-layout="blocks"] [data-home-opener] h1')).toHaveText("Everyday essentials, clearly presented");
    await expect(page.locator(".home-opener__primary")).toHaveAttribute("href", "#catalog-title");
    await expect(page.locator('.home-opener__actions a[href="#managed-product"]')).toHaveText("See availability proof");

    await writeFile(resolve(evidence, "revision-assertions.json"), JSON.stringify({
      revisionRetainedBlocks: true,
      legacyContentRetainedDuringBlocksEdit: JSON.stringify(originalContent) === JSON.stringify(original.content),
      legacyFallbackAfterLayoutRemoval: true,
      publicEditMode: "authenticated Edit-mode toolbar and rendered first-class block; editing remains in admin",
      independentHomeOpenerCopy: true,
      legacyRevisionRestored: true,
      migrationPreviewNoWrite: true,
      migrationApplyPreservesContent: true,
      migrationRerunSkipped: true,
      queryLimit: 1,
      draftExcluded: true,
      safeLinkRendered: true,
    }, null, 2) + "\n");
  } finally {
    const restored = await admin.request.put(`/_emdash/api/content/pages/${item.id}?locale=en`, { headers, data: { data: original } });
    expect(restored.ok(), await restored.text()).toBe(true);
    const republished = await admin.request.post(`/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(republished.ok(), await republished.text()).toBe(true);
    await context.close();
  }
});
