import { statSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import {
  STOREFRONT_SEARCHABLE_COLLECTIONS,
  ensureStorefrontSearchSupport,
} from "../src/features/store-shell/search-upgrade.ts";

function resolveDatabaseArgument(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--database=")) {
      return arg.slice("--database=".length).trim();
    }
    if (arg === "--database" && typeof argv[i + 1] === "string") {
      return argv[i + 1]!.trim();
    }
  }
  const envUrl = process.env.DINKUS_TEMPLATE_DB_URL?.trim();
  if (envUrl) {
    return envUrl.startsWith("file:") ? envUrl.slice("file:".length) : envUrl;
  }
  return ".artifacts/dev/content.db";
}

async function main(): Promise<void> {
  const rawTarget = resolveDatabaseArgument(process.argv.slice(2));
  if (!rawTarget) {
    throw new Error("Missing SQLite database path. Pass --database=.artifacts/dev/content.db.");
  }
  const databasePath = resolve(rawTarget);
  let stat;
  try {
    stat = statSync(databasePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Initialized SQLite database not found at ${databasePath} (${detail}).`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Refusing to upgrade empty or non-file SQLite target at ${databasePath}.`);
  }

  const db = new Kysely<never>({ dialect: createDialect({ url: databasePath }) });
  try {
    await runMigrations(db as never);
    await ensureStorefrontSearchSupport(db);
    console.log(
      JSON.stringify({
        action: "search-upgrade",
        database: databasePath,
        collections: Object.keys(STOREFRONT_SEARCHABLE_COLLECTIONS),
      }),
    );
  } finally {
    await db.destroy();
  }
}

await main();
