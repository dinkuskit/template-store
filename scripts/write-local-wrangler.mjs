import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionPath = resolve(root, "wrangler.jsonc");
const localPath = resolve(root, ".artifacts/wrangler.local.jsonc");
const idPath = resolve(root, ".artifacts/local-d1-id");

function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

const production = parseJsonc(readFileSync(productionPath, "utf8"));
const databases = production.d1_databases;
if (!Array.isArray(databases) || databases.length !== 1) {
  throw new Error("Committed Wrangler config must declare exactly one D1 database.");
}
if (databases[0]?.database_id !== undefined) {
  throw new Error(
    "Committed Wrangler config must omit database_id. Refusing to copy a placeholder into the local config.",
  );
}

mkdirSync(dirname(localPath), { recursive: true });
let databaseId = "";
try {
  databaseId = readFileSync(idPath, "utf8").trim().toLowerCase();
} catch {
  databaseId = "";
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(databaseId)) {
  databaseId = randomUUID();
  writeFileSync(idPath, `${databaseId}\n`);
}

// `@cloudflare/vite-plugin` resolves `main` from the config file's directory.
// This file lives under `.artifacts`, so a relative `./src/worker.ts` would miss the real entry.
const local = {
  ...production,
  main: resolve(root, "src/worker.ts"),
  assets: {
    ...production.assets,
    directory: resolve(root, "dist/client"),
  },
  d1_databases: [{ ...databases[0], database_id: databaseId }],
};
writeFileSync(localPath, `${JSON.stringify(local, null, 2)}\n`);
console.error(`local wrangler config: ${localPath}`);
