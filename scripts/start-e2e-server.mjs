import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  buildOfflineE2EEnvironment,
  validateOfflineE2EOptions,
} from "./lib/offline-e2e-environment.mjs";

// EmDash's local SQLite adapter needs node:sqlite StatementSync.columns() (Node >=22.16).
// Older Node fails every migration with "statement.columns is not a function".
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 22 || nodeMinor < 16) {
  console.error(`start-e2e-server: Node ${process.versions.node} is unsupported; use Node 22.16+ (.nvmrc pins 22.23.2).`);
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
