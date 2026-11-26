#!/usr/bin/env node
// Pin audit: every external commit this repository pins must be listed in
// .github/reviewed-pins.json under its source repository. The pins are each
// workflow `uses:` (actions and reusable workflows), the agent skill commits
// (scripts/agent-skills) and the runtime sources (package.json
// dinkuskit.sourcePins, dinkuskit.playgroundPlugins and Git dependencies).
// tests/workflows/pin-audit.test.mjs runs it in bin/verify-web, so CI's Store
// checks fail on an unlisted pin. --resolve also fetches every pinned commit
// from its source repository, and with --base <commit> (such as origin/main)
// writes the source diff of each pin the change moves under --out (default
// .artifacts/pin-audit) for the reviewer.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const COMMIT = /^[0-9a-f]{40}$/u;
// Git's empty tree: what a newly pinned source is compared with.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const REVIEWED_PINS = ".github/reviewed-pins.json";

function git(cwd, args, options = {}) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options });
}

/** Reads this checkout's files, or a commit's (the base a change is compared with). */
export function treeReader(root = projectRoot, commit = null) {
  if (!commit) {
    return {
      read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null),
      list: (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []),
    };
  }
  const show = (args) => {
    try {
      return git(root, args);
    } catch {
      return null;
    }
  };
  return {
    read: (path) => show(["show", `${commit}:${path}`]),
    list: (dir) => (show(["ls-tree", "--name-only", `${commit}:${dir}`]) ?? "").split("\n").filter(Boolean),
  };
}

/** Every external pin as { kind, repository, commit, where }. A pin this cannot read as owner/repo at a commit is kept, so the audit refuses it. */
export function collectPins({ read, list } = treeReader()) {
  const pins = [];
  const add = (kind, repository, commit, where) => pins.push({ kind, repository, commit, where });

  const workflowFiles = [
    ...list(".github/workflows").filter((name) => /\.ya?ml$/u.test(name)).map((name) => `.github/workflows/${name}`),
    ...list(".github/actions").flatMap((name) => [`.github/actions/${name}/action.yml`, `.github/actions/${name}/action.yaml`]),
  ];
  for (const file of workflowFiles) {
    (read(file) ?? "").split("\n").forEach((line, index) => {
      const used = line.match(/^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/u)?.[1];
      // ./ is this repository's own action or workflow.
      if (!used || used.startsWith("./")) return;
      const [, repository, commit] = used.match(/^([^/@]+\/[^/@]+)(?:\/[^@]*)?@(.+)$/u) ?? [null, used, ""];
      add("workflow", repository, commit, `${file}:${index + 1}`);
    });
  }

  const skills = read("scripts/agent-skills") ?? "";
  const skillRepositories = new Map(
    [...skills.matchAll(/^\s*([A-Z0-9_]+)_REPO=["']?https:\/\/github\.com\/([^/"'\s]+\/[^/"'\s]+?)(?:\.git)?["']?\s*$/gmu)].map((match) => [match[1], match[2]]),
  );
  for (const [, name, commit] of skills.matchAll(/^\s*([A-Z0-9_]+)_SHA=["']?([^"'\s]*)/gmu)) {
    // A skill set without its own *_REPO comes from the one repository the script names.
    const repository = skillRepositories.get(name) ?? (skillRepositories.size === 1 ? [...skillRepositories.values()][0] : `${name}_REPO`);
    add("skill", repository, commit, `scripts/agent-skills ${name}_SHA`);
  }

  const manifest = JSON.parse(read("package.json") ?? "{}");
  for (const group of ["sourcePins", "playgroundPlugins"]) {
    for (const [name, pin] of Object.entries(manifest.dinkuskit?.[group] ?? {})) {
      const url = String(pin?.repository ?? "");
      add("runtime", url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u)?.[1] ?? url, String(pin?.commit ?? ""), `package.json dinkuskit.${group}.${name}`);
    }
  }
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, value] of Object.entries(manifest[group] ?? {})) {
      const spec = String(value);
      if (!/^(?:github:|git[+:@]|https?:)|#/u.test(spec)) continue;
      const [source, commit = ""] = spec.split("#");
      add("runtime", source.match(/github(?:\.com)?[:/]([^/]+\/[^/]+?)(?:\.git)?$/u)?.[1] ?? source, commit, `package.json ${group}.${name}`);
    }
  }
  return pins;
}

/** One line per pin that is not a full commit listed, with its review note, under its source repository. */
export function auditPins(pins, reviewed) {
  const failures = [];
  for (const pin of pins) {
    const commits = Object.hasOwn(reviewed ?? {}, pin.repository) ? reviewed[pin.repository] : {};
    const note = Object.hasOwn(commits ?? {}, pin.commit) ? commits[pin.commit] : null;
    if (!COMMIT.test(pin.commit)) {
      failures.push(`${pin.where}: ${pin.repository}@${pin.commit || "(nothing)"} is not pinned to a full commit`);
    } else if (typeof note !== "string" || !note.trim()) {
      failures.push(`${pin.where}: ${pin.repository}@${pin.commit} is not listed in ${REVIEWED_PINS}; review its source, then list the commit there with where it was reviewed`);
    }
  }
  return failures;
}

/** The source diffs a reviewer needs: each newly pinned commit against every commit its repository was pinned to before, or against nothing. */
export function pinChanges(basePins, headPins) {
  const before = new Map();
  for (const pin of basePins) {
    if (COMMIT.test(pin.commit)) before.set(pin.repository, (before.get(pin.repository) ?? new Set()).add(pin.commit));
  }
  const changes = new Map();
  for (const pin of headPins) {
    const old = before.get(pin.repository) ?? new Set();
    if (!COMMIT.test(pin.commit) || old.has(pin.commit)) continue;
    for (const from of old.size > 0 ? old : [EMPTY_TREE]) {
      changes.set(`${pin.repository} ${from} ${pin.commit}`, { repository: pin.repository, from, to: pin.commit });
    }
  }
  return [...changes.values()];
}

const githubRemote = (repository) => `https://github.com/${repository}.git`;

/**
 * Fetches every pinned commit from its source repository and writes each change's source diff under
 * <out>/diffs. Returns one line per commit that does not resolve there.
 */
export function resolvePins({ pins, changes = [], out, remote = githubRemote }) {
  const failures = [];
  const scratch = mkdtempSync(join(tmpdir(), "pin-audit-"));
  const sources = new Map();
  const fetched = new Map();
  const fetchCommit = (repository, commit) => {
    const key = `${repository} ${commit}`;
    if (fetched.has(key)) return fetched.get(key);
    if (!sources.has(repository)) {
      sources.set(repository, join(scratch, String(sources.size)));
      git(scratch, ["init", "--quiet", "--bare", sources.get(repository)]);
    }
    let resolved = false;
    try {
      git(sources.get(repository), ["fetch", "--quiet", "--depth", "1", remote(repository), commit]);
      resolved = git(sources.get(repository), ["rev-parse", "FETCH_HEAD^{commit}"]).trim() === commit;
    } catch {
      resolved = false;
    }
    if (!resolved) failures.push(`${repository}@${commit} does not resolve in ${remote(repository)}`);
    fetched.set(key, resolved);
    return resolved;
  };
  try {
    for (const pin of pins) {
      if (COMMIT.test(pin.commit)) fetchCommit(pin.repository, pin.commit);
    }
    mkdirSync(join(out, "diffs"), { recursive: true });
    for (const change of changes) {
      if (!fetchCommit(change.repository, change.to) || (change.from !== EMPTY_TREE && !fetchCommit(change.repository, change.from))) continue;
      const name = `${change.repository.replaceAll("/", "__")}__${change.from === EMPTY_TREE ? "new" : change.from.slice(0, 12)}..${change.to.slice(0, 12)}.diff`;
      const file = openSync(join(out, "diffs", name), "w");
      try {
        git(sources.get(change.repository), ["diff", "--no-color", change.from, change.to], { stdio: ["ignore", file, "inherit"] });
      } finally {
        closeSync(file);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return failures;
}

// The real path, so a checkout reached through a symlink still runs the audit instead of passing silently.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { values } = parseArgs({ options: { resolve: { type: "boolean" }, base: { type: "string" }, out: { type: "string" } } });
  const out = values.out ?? join(projectRoot, ".artifacts/pin-audit");
  const pins = collectPins();
  const failures = auditPins(pins, JSON.parse(readFileSync(join(projectRoot, REVIEWED_PINS), "utf8")).reviewed);
  let changes = [];
  // A push that creates a branch has no earlier commit (all zeros): nothing to compare with.
  if (values.base && !/^0+$/u.test(values.base)) {
    try {
      const base = git(projectRoot, ["merge-base", values.base, "HEAD"]).trim();
      changes = pinChanges(collectPins(treeReader(projectRoot, base)), pins);
    } catch {
      failures.push(`base commit ${values.base} is not in this checkout, so the moved pins cannot be found`);
    }
  }
  if (values.resolve) {
    failures.push(...resolvePins({ pins, changes, out }));
    writeFileSync(join(out, "pins.json"), `${JSON.stringify({ pins, changes, failures }, null, 2)}\n`);
  }
  for (const change of changes) console.log(`pin audit: moved ${change.repository} ${change.from === EMPTY_TREE ? "(new)" : change.from} -> ${change.to}`);
  for (const failure of failures) console.error(`pin audit: ${failure}`);
  if (failures.length > 0) process.exit(1);
  console.log(`pin audit: ${pins.length} pins, each listed in ${REVIEWED_PINS}${values.resolve ? " and resolved in its source repository" : ""}`);
}
