import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const relativeRoots = {
  proof: ".artifacts/e2e",
  shipping: ".artifacts/e2e-shipping",
};
const profile = process.env.DINKUS_STOREFRONT_PROFILE ?? "proof";
const lane = profile === "shipping" ? "shipping" : "proof";
const relativeDir = relativeRoots[lane];
const artifactDir = resolve(root, relativeDir);
const port = lane === "shipping"
  ? (process.env.DINKUS_SHIPPING_E2E_PORT ?? process.env.DINKUS_E2E_PORT ?? "4638")
  : (process.env.DINKUS_E2E_PORT ?? "4637");

if (artifactDir !== resolve(root, relativeRoots.proof) && artifactDir !== resolve(root, relativeRoots.shipping)) {
  throw new Error("e2e server refuses to reset a directory outside the disposable test roots");
}

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
    port,
    "--ignore-lock",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ASTRO_DEV_BACKGROUND: "0",
      DINKUS_PROOF_MODE: lane === "proof" ? "1" : "0",
      DINKUS_STOREFRONT_PROFILE: lane,
      DINKUS_TEMPLATE_DB_URL: `file:./${relativeDir}/content.db`,
      DINKUS_TEMPLATE_UPLOADS_DIR: `./${relativeDir}/uploads`,
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
