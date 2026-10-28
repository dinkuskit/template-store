// Local D1 proof for template-store-self-upgrade-20261028, fresh install: a brand-new store on D1
// is migrated and seeded by EmDash on its first request, the storefront upgrade then changes
// nothing the seed made, setup stays the owner's to finish, and nothing runs again afterwards.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.argv[2];
const persist = resolve(root, ".artifacts/fresh-install-proof");
const reference = resolve(root, ".artifacts/fresh-install-reference.sqlite");
const port = 8798;
const log = [];
const sqlite = (file, query) => JSON.parse(spawnSync("sqlite3", ["-json", file, query], { encoding: "utf8" }).stdout || "[]");

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
    const result = await fn();
    await new Promise(r => setTimeout(r, 1500));
    return result;
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    log.push(`--- ${label}\n${lines.join("").split("\n").filter(l => /storefront-upgrade|seed|error|Error/i.test(l)).join("\n")}`);
  }
}

const get = async path => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
  return { path, status: response.status, ...(path.includes("/api/") ? { body: (await response.text()).slice(0, 300) } : {}) };
};
const schema = file => ({
  collections: sqlite(file, "select slug, supports, url_pattern from _emdash_collections order by slug"),
  fields: sqlite(file, "select c.slug as collection, f.slug, f.type, f.required, f.label, coalesce(f.searchable, 0) as searchable from _emdash_fields f join _emdash_collections c on c.id = f.collection_id order by c.slug, f.slug"),
});
const options = file => Object.fromEntries(sqlite(file, "select name, value from options where name in ('emdash:seed_complete','emdash:setup_complete','dinkus:storefront-upgrades')").map(row => [row.name, row.value]));
const counts = file => Object.fromEntries(["ec_products", "ec_pages", "ec_categories"].map(table => [table, sqlite(file, `select count(*) as n from ${table}`)[0]?.n ?? null]));
const ftsTables = file => sqlite(file, "select name from sqlite_master where type = 'table' and name like '_emdash_fts_%' and name not like '%_data' and name not like '%_idx' and name not like '%_docsize' and name not like '%_config' and name not like '%_content' order by name").map(row => row.name);

function node(script, ...args) {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script, ...args], { cwd: root, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
}

rmSync(persist, { recursive: true, force: true });
rmSync(reference, { force: true });

// 1. A brand-new store: the first requests a fresh D1 ever serves.
const fresh = await withWorker("fresh install", async () => [await get("/"), await get("/products/"), await get("/_emdash/api/setup/status")]);
const file = d1File();
const afterFresh = { options: options(file), counts: counts(file), ftsTables: ftsTables(file) };

// 2. The same seed applied by EmDash alone, with no storefront upgrade, for comparison.
node(`
  import { readFileSync } from "node:fs";
  import { Kysely } from "kysely";
  import { runMigrations } from "emdash/db";
  import { createDialect } from "emdash/db/sqlite";
  import { applySeed } from "emdash/seed";
  const db = new Kysely({ dialect: createDialect({ url: process.argv[1] }) });
  await runMigrations(db);
  await applySeed(db, JSON.parse(readFileSync("seed/seed.json", "utf8")), { onConflict: "skip", skipMediaDownload: true });
  await db.destroy();`, reference);
const sameSchema = JSON.stringify(schema(file)) === JSON.stringify(schema(reference));
const diff = sameSchema ? [] : (() => {
  const a = schema(file), b = schema(reference);
  const key = row => JSON.stringify(row);
  const only = (x, y) => x.filter(row => !y.some(other => key(other) === key(row)));
  return { worker: [...only(a.collections, b.collections), ...only(a.fields, b.fields)], seedAlone: [...only(b.collections, a.collections), ...only(b.fields, a.fields)] };
})();

// 3. The owner finishes setup (EmDash's finalizeSetup sets this option), and the store restarts.
node(`
  import { Kysely } from "kysely";
  import { createDialect } from "emdash/db/sqlite";
  import { OptionsRepository } from "emdash";
  const db = new Kysely({ dialect: createDialect({ url: process.argv[1] }) });
  await new OptionsRepository(db).set("emdash:setup_complete", true);
  await db.destroy();`, file);
const afterSetup = await withWorker("after the owner's setup", async () => [await get("/"), await get("/products/")]);

console.log(JSON.stringify({
  d1File: file.replace(root + "/", ""), fresh, afterFresh,
  sameSchemaAsSeedAlone: sameSchema, diff,
  products: schema(file).fields.filter(f => f.collection === "products" && ["visual_label", "summary", "details"].includes(f.slug)),
  pagesAddress: schema(file).collections.find(c => c.slug === "pages")?.url_pattern,
  afterSetup, optionsAtEnd: options(file),
}, null, 2));
console.log(log.join("\n"));
