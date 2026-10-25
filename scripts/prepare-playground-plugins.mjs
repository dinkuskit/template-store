import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundlePlugin } from "@emdash-cms/plugin-cli";

// The playground installs Payments and Ship as Registry plugins, as a real
// store does. Each comes from its exact release tag and is packed with the
// official Registry packager, so the playground runs the same backend.js and
// manifest.json the Registry serves (GrillTrack playground-prospect-demo-20261022).

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, ".artifacts/source-deps");
const outRoot = resolve(root, ".artifacts/playground-plugins");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const pins = manifest.dinkuskit?.playgroundPlugins ?? {};

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed with status ${result.status ?? "unknown"}`);
  return result.stdout.trim();
}

for (const [name, pin] of Object.entries(pins)) {
  if (
    pin.repository !== `https://github.com/dinkuskit/${name}.git` ||
    !/^v\d+\.\d+\.\d+$/u.test(pin.tag) ||
    !/^[0-9a-f]{40}$/u.test(pin.commit)
  ) {
    throw new Error(`package.json playground plugin pin for ${name} must be the public repository, a release tag and a full commit.`);
  }
  const out = resolve(outRoot, name);
  const stampPath = resolve(out, "source.json");
  if (existsSync(stampPath) && JSON.parse(readFileSync(stampPath, "utf8")).commit === pin.commit) {
    console.log(`playground plugins: ${name} ${pin.tag} ready`);
    continue;
  }

  const source = resolve(sourceRoot, name);
  rmSync(source, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  git(["init", "-q"], source);
  git(["fetch", "-q", "--depth", "1", pin.repository, pin.commit], source);
  git(["checkout", "-q", "--detach", "FETCH_HEAD"], source);
  if (git(["rev-parse", "HEAD"], source) !== pin.commit) {
    throw new Error(`Prepared ${name} source did not resolve to the exact pinned commit.`);
  }

  rmSync(out, { recursive: true, force: true });
  const build = resolve(out, "build");
  mkdirSync(build, { recursive: true });
  const artifact = await bundlePlugin({ dir: source, outDir: build });
  const packed = resolve(out, "package");
  mkdirSync(packed, { recursive: true });
  const untar = spawnSync("tar", ["-xzf", artifact.tarballPath, "-C", packed], { stdio: "inherit" });
  if (untar.status !== 0) throw new Error(`Could not unpack the ${name} Registry bundle.`);
  const packedManifest = JSON.parse(readFileSync(resolve(packed, "manifest.json"), "utf8"));
  if (packedManifest.version !== pin.tag.slice(1)) {
    throw new Error(`${name} ${pin.tag} packed as version ${packedManifest.version}.`);
  }
  writeFileSync(stampPath, `${JSON.stringify({ tag: pin.tag, commit: pin.commit }, null, 2)}\n`);
  console.log(`playground plugins: ${name} ${pin.tag} packed`);
}
