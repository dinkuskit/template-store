import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(process.execPath, [resolve(import.meta.dirname, "start-e2e-server.mjs")], {
  stdio: "inherit",
  env: {
    ...process.env,
    DINKUS_STOREFRONT_PROFILE: "shipping",
    DINKUS_SHIPPING_E2E_PORT: process.env.DINKUS_SHIPPING_E2E_PORT ?? "4638",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
