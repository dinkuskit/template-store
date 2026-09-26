import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

rmSync(".artifacts/e2e", { recursive: true, force: true });
mkdirSync(".artifacts/e2e/uploads", { recursive: true });

const child = spawn(
  "pnpm",
  [
    "exec",
    "astro",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    process.env.DINKUS_E2E_PORT ?? "4321",
    "--ignore-lock",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ASTRO_DEV_BACKGROUND: "0",
      DINKUS_PROOF_MODE: "1",
      DINKUS_TEMPLATE_DB_URL: "file:./.artifacts/e2e/content.db",
      DINKUS_TEMPLATE_UPLOADS_DIR: "./.artifacts/e2e/uploads",
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
