import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commit = "5710fc185645ed56098aff5727da03483be067ea";
const digest = "cc76f8384ba86398fc367c635a263fb7bb01f10a7296bd6485d4e74fde56c200";
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (process.argv.length !== 3) throw new Error("Usage: pnpm verify:checkout-package <owner-commerce.tgz>");
if (manifest.dinkuskit.sourcePins.commerce.commit !== commit) {
  throw new Error("Checkout package proof must match the exact public source pin");
}
const archive = resolve(process.argv[2]);
if (statSync(archive).size > 32 * 1024 * 1024) throw new Error("Owner archive exceeds proof size limit");
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== digest) {
  throw new Error("Owner archive does not match the admitted SHA-256");
}
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
if (entries.some(entry => !entry.startsWith("package/") || entry.split("/").includes(".."))) {
  throw new Error("Owner archive contains an unexpected extraction path");
}
mkdirSync(join(root, ".artifacts"), { recursive: true });
const proofRoot = mkdtempSync(join(root, ".artifacts/checkout-package-"));
execFileSync("tar", ["-xzf", archive, "-C", proofRoot]);
const config = join(proofRoot, "vitest.config.mjs");
writeFileSync(config, `import { defineConfig } from "vitest/config";
export default defineConfig(${JSON.stringify({
  root,
  resolve: { alias: {
    "cloudflare:workers": join(root, "tests/mocks/cloudflare-workers.ts"),
    "@dinkuskit/commerce/features/checkout": join(proofRoot, "package/dist/features/checkout/index.js"),
  } },
  test: { include: ["tests/unit/checkout-host-*.test.ts"] },
})});\n`);
execFileSync("pnpm", ["exec", "vitest", "run", "--config", config], { cwd: root, stdio: "inherit" });
writeFileSync(join(proofRoot, "RECEIPT.json"), JSON.stringify({
  sourceCommit: commit, archiveSha256: digest,
  proof: "fresh extracted owner package with canonical host/wake unit integration fixtures",
  registryInstalled: false, hostedRuntime: false, realStripePayment: false,
}, null, 2) + "\n");
console.log(`checkout-package: verified ${commit} sha256:${digest}`);
