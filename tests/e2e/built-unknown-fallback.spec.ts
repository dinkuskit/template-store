import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const headers = { "X-EmDash-Request": "1" };
const missingNativeType = "missing_local_renderer";
const prepPort = process.env.DINKUS_BUILT_FALLBACK_PREP_PORT ?? "28639";
const builtPort = process.env.DINKUS_BUILT_FALLBACK_PORT ?? "28640";
const artifactDir = ".artifacts/built-unknown-fallback";
const proofRoot = resolve("runs/upstream-blocks-20260926/browser/built-unknown-fallback");

async function waitForOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "not started";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok) return;
      lastError = `${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

function startProcess(command: string, args: string[], env: Record<string, string>): ChildProcess {
  return spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      if (child.pid) child.kill("SIGKILL");
      resolveStop();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

test("production built server renders registered missing native and nested Portable Text fallbacks", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "bounded desktop production built-server proof");
  test.setTimeout(180_000);
  if (!existsSync(resolve("dist/server/entry.mjs"))) {
    throw new Error("dist/server/entry.mjs is required for production built-server fallback proof");
  }

  const root = resolve(artifactDir);
  await rm(root, { recursive: true, force: true });
  await mkdir(resolve(root, "uploads"), { recursive: true });
  await mkdir(proofRoot, { recursive: true });

  let prep: ChildProcess | undefined;
  let built: ChildProcess | undefined;
  const context = await browser.newContext();
  const admin = await context.newPage();
  try {
    prep = startProcess(process.execPath, [resolve("node_modules/astro/bin/astro.mjs"), "dev", "--host", "127.0.0.1", "--port", prepPort, "--ignore-lock"], {
      ASTRO_DEV_BACKGROUND: "0",
      DINKUS_PROOF_MODE: "0",
      DINKUS_STOREFRONT_PROFILE: "shipping",
      DINKUS_TEMPLATE_DB_URL: `file:./${artifactDir}/content.db`,
      DINKUS_TEMPLATE_UPLOADS_DIR: `./${artifactDir}/uploads`,
      EMDASH_SITE_URL: `http://127.0.0.1:${prepPort}`,
    });
    await waitForOk(`http://127.0.0.1:${prepPort}/_emdash/api/setup/dev-bypass`, 90_000);
    await admin.goto(`http://127.0.0.1:${prepPort}/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/pages/home`);
    const current = await admin.request.get(`http://127.0.0.1:${prepPort}/_emdash/api/content/pages/home`);
    expect(current.ok(), await current.text()).toBe(true);
    const item = (await current.json()).data.item as { id: string; data: Record<string, unknown> };
    const created = await admin.request.post(`http://127.0.0.1:${prepPort}/_emdash/api/schema/block-types`, {
      headers,
      data: {
        slug: missingNativeType,
        label: "Missing local renderer",
        category: "Proof",
        fields: [{ slug: "title", label: "Title", type: "string" }],
      },
    });
    expect([200, 201].includes(created.status()), await created.text()).toBe(true);
    const pages = await admin.request.get(`http://127.0.0.1:${prepPort}/_emdash/api/schema/collections/pages?includeFields=true`);
    expect(pages.ok(), await pages.text()).toBe(true);
    const fields = (await pages.json()).data.item.fields as Array<{ slug: string; validation?: Record<string, unknown> }>;
    const layout = fields.find((field) => field.slug === "layout");
    expect(layout).toBeTruthy();
    const allowed = await admin.request.put(`http://127.0.0.1:${prepPort}/_emdash/api/schema/collections/pages/fields/layout`, {
      headers,
      data: {
        validation: {
          ...(layout?.validation ?? {}),
          allowedTypes: ["home_opener", "rich_text", "query_card", missingNativeType],
          maxItems: 50,
        },
      },
    });
    expect(allowed.ok(), await allowed.text()).toBe(true);
    const proofLayout = [{
      _type: missingNativeType,
      _version: 1,
      _key: "native-unknown",
      title: "retained native block",
    }, {
      _type: "rich_text",
      _version: 1,
      _key: "legacy-rich-text-proof",
      content: [
        { _type: "dinkus.query-card", _key: "nested-query", source: "merchandise", limit: 1 },
        { _type: "dinkus.fact-rail", _key: "nested-facts", facts: [{ label: "Nested", value: "Preserved" }] },
        { _type: "dinkus.future-editorial-node", _key: "legacy-unknown", label: "retained raw node" },
      ],
    }];
    const saved = await admin.request.put(`http://127.0.0.1:${prepPort}/_emdash/api/content/pages/${item.id}?locale=en`, {
      headers, data: { data: { ...item.data, layout: proofLayout } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const published = await admin.request.post(`http://127.0.0.1:${prepPort}/_emdash/api/content/pages/${item.id}/publish?locale=en`, { headers });
    expect(published.ok(), await published.text()).toBe(true);
    await stopProcess(prep);
    prep = undefined;

    const liveDb = resolve(artifactDir, "content.db");
    const copiedDb = resolve(artifactDir, "production-copy.db");
    execFileSync("sqlite3", [liveDb, "PRAGMA wal_checkpoint(FULL);"], { encoding: "utf8" });
    execFileSync("sqlite3", [liveDb, `.backup '${copiedDb.replaceAll("'", "''")}'`], { encoding: "utf8" });
    expect(execFileSync("sqlite3", [copiedDb, "PRAGMA integrity_check;"], { encoding: "utf8" }).trim()).toBe("ok");
    const backedLayout = execFileSync("sqlite3", [copiedDb, "SELECT layout FROM ec_pages WHERE slug = 'home';"], { encoding: "utf8" });
    expect(backedLayout).toContain(missingNativeType);
    execFileSync(process.execPath, [resolve("node_modules/astro/bin/astro.mjs"), "build"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DINKUS_TEMPLATE_DB_URL: `file:./${artifactDir}/production-copy.db`,
        DINKUS_TEMPLATE_UPLOADS_DIR: `./${artifactDir}/uploads`,
        EMDASH_SITE_URL: `http://127.0.0.1:${builtPort}`,
        DINKUS_STOREFRONT_PROFILE: "shipping",
        DINKUS_PROOF_MODE: "0",
      },
    });
    built = startProcess(process.execPath, [resolve("scripts/start-built-fallback-server.mjs")], {
      DINKUS_BUILT_FALLBACK_PORT: builtPort,
      DINKUS_BUILT_FALLBACK_DIR: artifactDir,
      DINKUS_BUILT_FALLBACK_DB: "production-copy.db",
    });
    await waitForOk(`http://127.0.0.1:${builtPort}/`, 60_000);
    const publicPage = await context.newPage();
    await publicPage.goto(`http://127.0.0.1:${builtPort}/`);
    await writeFile(resolve(proofRoot, "public-built-unknown-fallback.html"), await publicPage.content());
    await expect(publicPage.locator(`[data-layout="blocks"] [data-emdash-missing-block="${missingNativeType}"]`)).toHaveCount(1);
    await expect(publicPage.locator('[data-layout="blocks"] .layout-rich-text .dinkus-fact-rail')).toHaveCount(1);
    await expect(publicPage.locator('[data-layout="blocks"] .layout-rich-text [data-emdash-unsupported-content="dinkus.future-editorial-node"]')).toHaveCount(1);
    const screenshotPath = resolve(proofRoot, "public-built-unknown-fallback.png");
    await publicPage.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
    await writeFile(resolve(proofRoot, "OUTPUT-PATH.txt"), `${screenshotPath}\n`);
    await publicPage.close();
  } finally {
    await context.close();
    await stopProcess(built);
    await stopProcess(prep);
  }
});
