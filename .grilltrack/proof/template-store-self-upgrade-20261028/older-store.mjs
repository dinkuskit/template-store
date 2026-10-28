// Local D1 proof for template-store-self-upgrade-20261028: an older store on D1 takes the
// template's newer schema on its first request after a deploy, and only once.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.argv[2];
const persist = resolve(root, ".artifacts/self-upgrade-proof");
const require = createRequire(resolve(root, "package.json"));
const port = 8797;
const log = [];
const sqlite = (file, query) => spawnSync("sqlite3", ["-json", file, query], { encoding: "utf8" });

function d1File() {
  const dir = resolve(persist, "v3/d1/miniflare-D1DatabaseObject");
  const file = readdirSync(dir).find(name => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  return resolve(dir, file);
}

async function withWorker(label, fn) {
  const child = spawn(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "-c", "dist/server/wrangler.json",
    "--persist-to", persist, "--port", String(port), "--ip", "127.0.0.1", "--local", "--show-interactive-dev-session=false"],
    { cwd: root, env: { ...process.env, NO_PROXY: "127.0.0.1,localhost" }, detached: true });
  const lines = [];
  child.stdout.on("data", d => lines.push(String(d)));
  child.stderr.on("data", d => lines.push(String(d)));
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try { await fetch(`http://127.0.0.1:${port}/robots.txt`, { signal: AbortSignal.timeout(3000) }); break; } catch {}
      if (Date.now() > deadline) throw new Error(`wrangler never answered:\n${lines.join("").slice(-2000)}`);
      await new Promise(r => setTimeout(r, 500));
    }
    return await fn();
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    log.push(`--- ${label}\n${lines.join("").split("\n").filter(l => /storefront-upgrade|error|Error/.test(l)).join("\n")}`);
  }
}

const page = async path => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" }); return r.status; };
const fields = file => JSON.parse(sqlite(file, "select f.slug, f.required, f.label from _emdash_fields f join _emdash_collections c on c.id = f.collection_id where c.slug = 'products' and f.slug in ('visual_label','summary','details') order by f.slug").stdout || "[]");
const recorded = file => JSON.parse(sqlite(file, "select value from options where name = 'dinkus:storefront-upgrades'").stdout || "[]")[0]?.value ?? null;
const pages = file => JSON.parse(sqlite(file, "select url_pattern from _emdash_collections where slug = 'pages'").stdout || "[]")[0]?.url_pattern ?? null;

rmSync(persist, { recursive: true, force: true });
// 1. A fresh local D1: EmDash migrates it on the first request.
await withWorker("fresh", () => page("/"));
const file = d1File();
// 2. Make it an older store: EmDash's tables plus the apparel-only seed the beta store was set up
//    from, written into the same D1 file while no Worker runs, with no upgrade record.
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
const seedScript = `
  import { readFileSync } from "node:fs";
  import { Kysely } from "kysely";
  import { runMigrations } from "emdash/db";
  import { createDialect } from "emdash/db/sqlite";
  import { applySeed } from "emdash/seed";
  import { OptionsRepository } from "emdash";
  const db = new Kysely({ dialect: createDialect({ url: process.argv[1] }) });
  await runMigrations(db);
  // A store its owner already set up.
  await new OptionsRepository(db).set("emdash:setup_complete", true);
  await applySeed(db, JSON.parse(readFileSync("tests/fixtures/seed-before-product-categories.json", "utf8")), { includeContent: true, onConflict: "skip", skipMediaDownload: true });
  await db.destroy();`;
const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", seedScript, file], { cwd: root, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(seeded.stderr);
const before = { fields: fields(file), pages: pages(file), recorded: recorded(file) };
// 3. "Deploy": a new isolate serves its first request.
const firstStatus = await withWorker("after deploy", () => page("/"));
const after = { fields: fields(file), pages: pages(file), recorded: recorded(file) };
// 4. Another isolate: nothing runs again.
const secondStatus = await withWorker("next isolate", () => page("/"));
console.log(JSON.stringify({ d1File: file.replace(root + "/", ""), before, firstStatus, after, secondStatus, again: recorded(file) }, null, 2));
console.log(log.join("\n"));
