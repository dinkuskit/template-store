import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  buildOfflineE2EEnvironment,
  validateOfflineE2EOptions,
} from "./lib/offline-e2e-environment.mjs";

// EmDash's local SQLite adapter needs node:sqlite StatementSync.columns(), and Node 22's
// node:sqlite has critical bugs. Keep this in step with package.json engines
// (^24.15.0 || ^26.0.0): @emdash-cms/registry-verification needs ^24.15.0 || >=26.0.0
// (no Node 25) and better-sqlite3 supports up to 26.x.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (!((nodeMajor === 24 && nodeMinor >= 15) || nodeMajor === 26)) {
  console.error(`start-e2e-server: Node ${process.versions.node} is unsupported; use Node ^24.15.0 || ^26.0.0 (.nvmrc pins 24.22.0).`);
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const profile = process.env.DINKUS_STOREFRONT_PROFILE ?? "proof";
const options = validateOfflineE2EOptions({
  root,
  profile,
  port: profile === "shipping"
    ? (process.env.DINKUS_SHIPPING_E2E_PORT ?? process.env.DINKUS_E2E_PORT ?? "4638")
    : (process.env.DINKUS_E2E_PORT ?? "4637"),
});
const { artifactDir } = options;

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(resolve(artifactDir, "uploads"), { recursive: true });

const child = spawn(
  "pnpm",
  [
    "exec",
    "astro",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(options.port),
    "--ignore-lock",
  ],
  {
    stdio: "inherit",
    env: buildOfflineE2EEnvironment(process.env, options),
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
