import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const entry = resolve(root, "dist/server/entry.mjs");
const port = process.env.DINKUS_BUILT_FALLBACK_PORT ?? "28640";
const relativeDir = process.env.DINKUS_BUILT_FALLBACK_DIR ?? ".artifacts/built-unknown-fallback";
const dbFile = process.env.DINKUS_BUILT_FALLBACK_DB ?? "production-copy.db";
const artifactDir = resolve(root, relativeDir);
const databasePath = resolve(artifactDir, dbFile);

if (!existsSync(entry)) {
  throw new Error("Production built fallback requires dist/server/entry.mjs; run the pinned Node 22 astro build first.");
}
if (!existsSync(databasePath)) {
  throw new Error("Production built fallback requires a SQLite backup copy in the isolated artifact directory.");
}

const child = spawn(process.execPath, [entry], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    DINKUS_PROOF_MODE: "0",
    DINKUS_STOREFRONT_PROFILE: "shipping",
    DINKUS_TEMPLATE_DB_URL: `file:./${relativeDir}/${dbFile}`,
    DINKUS_TEMPLATE_UPLOADS_DIR: `./${relativeDir}/uploads`,
    EMDASH_SITE_URL: `http://127.0.0.1:${port}`,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
