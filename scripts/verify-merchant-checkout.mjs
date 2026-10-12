import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.COMMERCE_READINESS_ARTIFACT_DIR) {
  console.error("Set COMMERCE_READINESS_ARTIFACT_DIR to the qualified local Commerce package directory.");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", "tests/workflows/registry-merchant-checkout.test.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
