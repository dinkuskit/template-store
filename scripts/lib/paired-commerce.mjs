import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The Commerce this store runs: the Registry (sandboxed) build, the one build Commerce keeps
// (template-one-build-registry-20261031), mounted through EmDash's `sandboxed: [...]` the way a Registry
// store installs it. Local dev, the proof store CI's browser tests use, the hosted demo build and the
// paired publish-check proof all take it from here: the pinned Commerce (package.json
// dinkuskit.sourcePins.commerce) fetched and built once per commit, or a checkout a developer is
// building (DINKUS_PAIRED_COMMERCE_DIR), which is EmDash's documented loop: build the plugin, run the site.

const projectRoot = resolve(import.meta.dirname, "../..");

export const PAIRED_COMMERCE_DIR_ENV = "DINKUS_PAIRED_COMMERCE_DIR";
/** The files a built Registry bundle has: the plugin workerd runs and the descriptor `sandboxed: [...]` takes. */
export const REGISTRY_BUILD_FILES = Object.freeze(["dist/sandbox/plugin.mjs", "dist/sandbox/index.mjs"]);

/** The exact Commerce commit this template pairs with, from package.json. */
export function pairedCommercePin(root = projectRoot) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const pin = manifest.dinkuskit?.sourcePins?.commerce;
  if (
    pin?.repository !== "https://github.com/dinkuskit/commerce.git" ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/u.test(pin.tag ?? "") ||
    !/^[0-9a-f]{40}$/u.test(pin.commit ?? "")
  ) {
    throw new Error("package.json dinkuskit.sourcePins.commerce must name the public repository, a tag and a full commit.");
  }
  return { repository: pin.repository, tag: pin.tag, commit: pin.commit };
}

/** The Registry package the pin's build is: a pre-release tag is the beta package, a release the stable one. */
export function pairedCommerceProfile(pin) {
  return pin.tag.includes("-") ? "beta" : "stable";
}

/** Where the pin's build lives, one directory per commit, under ignored .artifacts. */
export function pairedCommerceDefaultDir(pin, root = projectRoot) {
  return resolve(root, ".artifacts/paired-commerce", pin.commit);
}

export function hasRegistryBuild(dir) {
  return REGISTRY_BUILD_FILES.every((file) => existsSync(resolve(dir, file)));
}

/**
 * The built Commerce to mount, or null for a store that installs Commerce itself (a Registry store build) or
 * has none prepared yet. DINKUS_PAIRED_COMMERCE_DIR names a checkout a developer built; set empty, it means
 * none even when the pin's build exists.
 */
export function resolvePairedCommerceDir(env = process.env, root = projectRoot) {
  const explicit = env[PAIRED_COMMERCE_DIR_ENV];
  if (explicit !== undefined) {
    if (explicit.trim() === "") return null;
    const dir = resolve(root, explicit.trim());
    if (!hasRegistryBuild(dir)) {
      throw new Error(`${PAIRED_COMMERCE_DIR_ENV}=${explicit} has no built Registry bundle (${REGISTRY_BUILD_FILES.join(", ")}); run npm run build in that Commerce checkout.`);
    }
    return dir;
  }
  const dir = pairedCommerceDefaultDir(pairedCommercePin(root), root);
  return hasRegistryBuild(dir) ? dir : null;
}

export function pairedCommerceHead(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
}

/**
 * The pin's Registry build, fetched and built when missing (git fetch of the exact commit, npm ci without
 * scripts, npm run build). A developer's own DINKUS_PAIRED_COMMERCE_DIR is used as built, never rebuilt here.
 * Returns the directory, or null when DINKUS_PAIRED_COMMERCE_DIR is set empty.
 */
export function ensurePairedCommerceBuild({ env = process.env, root = projectRoot, log = console.log } = {}) {
  if (env[PAIRED_COMMERCE_DIR_ENV] !== undefined) {
    const dir = resolvePairedCommerceDir(env, root);
    log(dir ? `paired commerce: ${dir} (${PAIRED_COMMERCE_DIR_ENV})` : "paired commerce: none (DINKUS_PAIRED_COMMERCE_DIR is empty)");
    return dir;
  }
  const pin = pairedCommercePin(root);
  const dir = pairedCommerceDefaultDir(pin, root);
  if (hasRegistryBuild(dir) && pairedCommerceHead(dir) === pin.commit) {
    log(`paired commerce: ${pin.tag} ${pin.commit.slice(0, 12)} built`);
    return dir;
  }
  if (!dir.startsWith(`${resolve(root, ".artifacts")}/`)) throw new Error("Refusing to build Commerce outside .artifacts.");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run("git", ["init", "--quiet", dir], root);
  run("git", ["remote", "add", "origin", pin.repository], dir);
  run("git", ["fetch", "--quiet", "--depth", "1", "origin", pin.commit], dir);
  run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], dir);
  if (pairedCommerceHead(dir) !== pin.commit) throw new Error(`Fetched Commerce did not resolve to ${pin.commit}`);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  run("npm", ["run", "build"], dir);
  if (!hasRegistryBuild(dir)) throw new Error(`Commerce ${pin.tag} built no Registry bundle under ${dir}`);
  log(`paired commerce: ${pin.tag} ${pin.commit.slice(0, 12)} built`);
  return dir;
}

/**
 * The plugin EmDash's `sandboxed: [...]` takes: the built descriptor under the Registry runtime id of the
 * selected profile, as a Registry store installs it, running the built plugin file.
 */
export async function pairedCommerceDescriptor(dir, runtimeId) {
  const descriptor = (await import(pathToFileURL(resolve(dir, "dist/sandbox/index.mjs")).href)).default;
  return { ...descriptor, id: runtimeId, entrypoint: resolve(dir, "dist/sandbox/plugin.mjs") };
}
