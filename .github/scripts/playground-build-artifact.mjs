import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const controls = [
  ".github/scripts/playground-build-artifact.mjs", ".github/workflows/ci.yml", ".nvmrc",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "astro.playground.config.mjs",
  "wrangler.playground.jsonc", "scripts/prepare-source-deps.mjs", "scripts/prepare-playground-plugins.mjs",
  "scripts/lib/paired-commerce.mjs", "src/features/commerce-profile/profiles.mjs",
  "src/features/playground-plugins/registry-plugins.mjs",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (message) => { throw new Error(message); };
const forbidden = (name) => /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.npmrc|\.netrc|\.git|\.ssh|\.gnupg)$/u.test(name);

function git(root, ...args) {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { refuse("Unable to verify clean checkout identity"); }
}

function inside(root, path) {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) refuse("Path leaves the checkout");
  let parent = path;
  while (parent !== root) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) refuse("Artifact paths must not traverse links");
    parent = dirname(parent);
  }
  return path;
}

function safePath(path) {
  if (typeof path !== "string" || path.includes("\\") || path.includes("\0") ||
      !path.startsWith("dist") || path.split("/").some((part) => !part || part === "." || part === ".." || forbidden(part)) ||
      (path !== "dist" && !path.startsWith("dist/"))) refuse("Unsafe artifact member path");
  return path;
}

export function buildInputs(root, env) {
  root = realpathSync(root);
  const source = env.SOURCE_SHA;
  if (!/^[a-f0-9]{40}$/u.test(source ?? "")) refuse("Missing exact SOURCE_SHA");
  if (git(root, "rev-parse", "--show-toplevel") !== root || git(root, "rev-parse", "HEAD") !== source) refuse("Checkout does not match SOURCE_SHA");
  git(root, "diff", "--no-ext-diff", "--quiet");
  git(root, "diff", "--cached", "--no-ext-diff", "--quiet");
  if (git(root, "ls-files", "--others", "--exclude-standard")) refuse("Checkout contains untracked source inputs");
  if (env.GITHUB_REPOSITORY !== "dinkuskit/template-store" || env.GITHUB_REPOSITORY_ID !== "1306882668") refuse("Unexpected repository identity");
  for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) if (!/^[1-9][0-9]*$/u.test(env[key] ?? "")) refuse(`Missing ${key}`);
  if (!["push", "pull_request"].includes(env.GITHUB_EVENT_NAME)) refuse("Unexpected workflow event");
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_WORKFLOW_SHA ?? "") || !env.GITHUB_WORKFLOW_REF) refuse("Missing workflow identity");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(env.SOURCE_REPOSITORY ?? "")) refuse("Missing source repository identity");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(env.SOURCE_PR_NUMBER ?? "")) refuse("Missing source pull request identity");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const node = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  let pnpm;
  try { pnpm = execFileSync("pnpm", ["--version"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { refuse("Unable to verify pnpm version"); }
  if (process.version !== `v${node}` || pkg.packageManager !== `pnpm@${pnpm}`) refuse("Build toolchain does not match source pins");
  const profile = pkg.dinkuskit.sourcePins.commerce.tag.includes("-") ? "beta" : "stable";
  if (env.DINKUS_COMMERCE_PROFILE !== undefined && env.DINKUS_COMMERCE_PROFILE !== profile) refuse("Unexpected Commerce build profile");
  if (env.DINKUS_PLAYGROUND_WRANGLER_CONFIG !== undefined && !["wrangler.playground.jsonc", "./wrangler.playground.jsonc"].includes(env.DINKUS_PLAYGROUND_WRANGLER_CONFIG)) refuse("Unexpected playground build configuration");
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== "production") refuse("Unexpected build NODE_ENV");
  for (const key of ["DINKUS_PAIRED_COMMERCE_DIR", "CLOUDFLARE_ENV", "CLOUDFLARE_PREVIEW_BUILD", "CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT"]) {
    if (env[key] !== undefined) refuse(`Unsupported build override ${key}`);
  }
  if (Object.keys(env).some((key) => /^(?:PUBLIC_|VITE_)/u.test(key))) refuse("Unsupported public build environment override");
  if (readdirSync(root).some((name) => /^\.env(?:\..*)?$/u.test(name))) refuse("Checkout contains unqualified environment files");
  return {
    context: { repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID,
      run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, event: env.GITHUB_EVENT_NAME,
      workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_WORKFLOW_SHA,
      source, sourceRepository: env.SOURCE_REPOSITORY, pullRequest: env.SOURCE_PR_NUMBER },
    toolchain: { node: process.version, pnpm, platform: process.platform, architecture: process.arch },
    buildEnvironment: { commerceProfile: profile, wranglerConfig: "wrangler.playground.jsonc", nodeEnv: "production" },
    pins: pkg.dinkuskit,
    controls: Object.fromEntries(controls.map((path) => [path, digest(readFileSync(join(root, path)))])),
  };
}

function inventory(root, directory, files = []) {
  const stat = lstatSync(directory);
  const path = safePath(relative(root, directory).split(sep).join("/"));
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.mode & 0o7000)) refuse("Artifact contains a link or unsupported file type");
  const row = { path, type: stat.isDirectory() ? "directory" : "file", mode: stat.mode & 0o777 };
  files.push(row);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(directory).sort()) {
      if (forbidden(entry)) refuse("Artifact contains a configuration or credential file");
      inventory(root, join(directory, entry), files);
    }
  } else { row.bytes = stat.size; row.sha256 = digest(readFileSync(directory)); }
  return files;
}

function assertClosure(root) {
  const path = join(root, "dist/server/wrangler.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (config.no_bundle !== true || typeof config.main !== "string" || typeof config.assets?.directory !== "string") refuse("Expected the adapter's complete prebundled Worker and assets");
  if (config.build?.command || config.site || config.containers?.length) refuse("Artifact requires unsupported external build inputs");
  for (const section of [config, config.previews]) {
    if (section?.kv_namespaces?.some(({ binding }) => binding === "SESSION")) refuse("Artifact still contains SESSION");
    for (const field of ["main", "base_dir", "tsconfig"]) if (section?.[field] !== undefined) safePath(relative(root, resolve(dirname(path), section[field])).split(sep).join("/"));
    if (section?.assets?.directory) safePath(relative(root, resolve(dirname(path), section.assets.directory)).split(sep).join("/"));
    for (const field of ["wasm_modules", "text_blobs", "data_blobs"]) {
      for (const value of Object.values(section?.[field] ?? {})) safePath(relative(root, resolve(dirname(path), value)).split(sep).join("/"));
    }
    if (section?.d1_databases?.some((db) => db.migrations_dir)) refuse("Artifact requires migration files outside its qualified closure");
  }
  if (!lstatSync(resolve(dirname(path), config.main)).isFile() || !lstatSync(resolve(dirname(path), config.assets.directory)).isDirectory()) refuse("Worker entry or assets are missing");
}

function copyEntries(from, to, entries) {
  for (const entry of entries) {
    const target = join(to, safePath(entry.path));
    if (entry.type === "directory") mkdirSync(target, { recursive: true });
    else { mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(from, entry.path), target); }
    chmodSync(target, entry.mode);
  }
}

export function packBuild(root, artifact, env) {
  root = realpathSync(root); artifact = inside(root, resolve(root, artifact));
  const inputs = buildInputs(root, env);
  const entries = inventory(root, join(root, "dist"));
  const bytes = entries.reduce((total, row) => total + (row.bytes ?? 0), 0);
  if (entries.length > 20000 || bytes > 100 * 1024 * 1024) refuse("Artifact exceeds the bounded handoff size");
  assertClosure(root);
  if (existsSync(artifact)) refuse("Artifact staging directory already exists");
  mkdirSync(join(artifact, "payload"), { recursive: true });
  copyEntries(root, join(artifact, "payload"), entries);
  const manifest = JSON.stringify({ schema: 1, inputs, entries }, null, 2) + "\n";
  writeFileSync(join(artifact, "manifest.json"), manifest);
  return { manifestSha256: digest(manifest), bytes, files: entries.filter((row) => row.type === "file").length };
}

export function restoreBuild(root, artifact, destination, env, expectedSha) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha ?? "")) refuse("Missing trusted producer manifest SHA");
  const producerAttempt = env.PLAYGROUND_PRODUCER_ATTEMPT;
  if (!/^[1-9][0-9]*$/u.test(producerAttempt ?? "") ||
      !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
      BigInt(producerAttempt) > BigInt(env.GITHUB_RUN_ATTEMPT)) refuse("Invalid trusted producer attempt");
  root = realpathSync(root); artifact = inside(root, resolve(root, artifact)); destination = inside(root, resolve(root, destination));
  if (lstatSync(artifact).isSymbolicLink() || !isDeepStrictEqual(readdirSync(artifact).sort(), ["manifest.json", "payload"])) refuse("Unexpected artifact root members");
  const manifestPath = join(artifact, "manifest.json");
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) refuse("Invalid artifact manifest file");
  const raw = readFileSync(manifestPath);
  if (digest(raw) !== expectedSha) refuse("Artifact manifest does not match trusted producer output");
  const manifest = JSON.parse(raw);
  // Failed-job-only reruns may reuse a successful producer from an earlier attempt.
  // Its attempt comes from the same trusted job outputs as the manifest SHA/name.
  if (manifest.schema !== 1 || !isDeepStrictEqual(manifest.inputs, buildInputs(root, { ...env, GITHUB_RUN_ATTEMPT: producerAttempt }))) refuse("Artifact source, run, trust, toolchain or build inputs differ");
  if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 20000) refuse("Invalid artifact inventory");
  const names = new Set();
  for (const row of manifest.entries) {
    safePath(row.path);
    if (names.has(row.path) || !["file", "directory"].includes(row.type) || !Number.isInteger(row.mode) || row.mode < 0 || row.mode > 0o777) refuse("Invalid artifact member metadata");
    if (row.type === "file" && (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[a-f0-9]{64}$/u.test(row.sha256 ?? ""))) refuse("Invalid artifact file metadata");
    names.add(row.path);
  }
  if (!manifest.entries.some((row) => row.path === "dist" && row.type === "directory")) refuse("Missing artifact root directory");
  for (const row of manifest.entries) {
    if (row.path !== "dist" && !manifest.entries.some((parent) => parent.path === dirname(row.path) && parent.type === "directory")) refuse("Missing artifact parent directory");
  }
  const payload = join(artifact, "payload");
  if (lstatSync(payload).isSymbolicLink() || !isDeepStrictEqual(readdirSync(payload), ["dist"])) refuse("Unexpected artifact payload members");
  const actual = inventory(payload, join(payload, "dist"));
  const expectedFiles = manifest.entries.filter((row) => row.type === "file");
  if (expectedFiles.reduce((total, row) => total + row.bytes, 0) > 100 * 1024 * 1024) refuse("Artifact exceeds the bounded handoff size");
  const observedFiles = actual.filter((row) => row.type === "file");
  if (observedFiles.length !== expectedFiles.length || expectedFiles.some((expected) => {
    const observed = observedFiles.find((row) => row.path === expected.path);
    return !observed || observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256;
  })) refuse("Artifact files are missing, additional or corrupt");
  if (actual.some((row) => !names.has(row.path))) refuse("Additional artifact directory");
  assertClosure(payload);
  if (existsSync(join(destination, "dist"))) refuse("Restore destination already contains dist");
  // The trusted manifest recreates empty directories and modes lost by ZIP transport.
  copyEntries(payload, destination, manifest.entries);
  assertClosure(destination);
  return { manifestSha256: expectedSha, files: expectedFiles.length };
}

if (import.meta.main) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "--help") { console.log("playground-build-artifact pack|restore [--artifact-dir PATH] [--destination PATH]"); process.exit(0); }
    const options = { "--artifact-dir": ".artifacts/playground-ci-artifact", "--destination": "." };
    while (args.length) { const key = args.shift(); if (!(key in options) || !args.length) refuse("Invalid arguments"); options[key] = args.shift(); }
    const result = mode === "pack" ? packBuild(process.cwd(), options["--artifact-dir"], process.env)
      : mode === "restore" ? restoreBuild(process.cwd(), options["--artifact-dir"], options["--destination"], process.env, process.env.PLAYGROUND_MANIFEST_SHA)
      : refuse("Expected pack or restore");
    if (mode === "pack" && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `manifest_sha256=${result.manifestSha256}\nproducer_attempt=${process.env.GITHUB_RUN_ATTEMPT}\nartifact_name=playground-build-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${process.env.SOURCE_SHA}\n`);
    console.log(JSON.stringify({ mode, ...result }));
  } catch (error) { console.error(`playground-build-artifact: ${error.message}`); process.exitCode = 1; }
}
