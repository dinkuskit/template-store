import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, ".artifacts/source-deps");
const commerceRoot = resolve(sourceRoot, "commerce");
const repository = "https://github.com/dinkuskit/commerce.git";
const commit = "81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06";

function git(args, cwd = root, allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: allowFailure ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args[0]} failed with status ${result.status ?? "unknown"}`);
  }
  return result;
}

const observed = git(["rev-parse", "HEAD"], commerceRoot, true);
if (observed.status === 0 && observed.stdout.trim() === commit) {
  console.log(`source prep: commerce ${commit.slice(0, 12)} ready`);
  process.exit(0);
}

if (!commerceRoot.startsWith(`${sourceRoot}/`)) {
  throw new Error("Refusing to replace a source dependency outside .artifacts/source-deps.");
}
rmSync(commerceRoot, { recursive: true, force: true });
await mkdir(dirname(commerceRoot), { recursive: true });
git(["init", commerceRoot]);
git(["remote", "add", "origin", repository], commerceRoot);
git(["fetch", "--depth", "1", "origin", commit], commerceRoot);
git(["checkout", "--detach", "FETCH_HEAD"], commerceRoot);
const verified = git(["rev-parse", "HEAD"], commerceRoot, true);
if (verified.status !== 0 || verified.stdout.trim() !== commit) {
  throw new Error("Prepared Commerce source did not resolve to the exact pinned commit.");
}
console.log(`source prep: commerce ${commit.slice(0, 12)} ready`);
