import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditPins, collectPins, pinChanges, resolvePins, REVIEWED_PINS } from "../../.github/scripts/pin-audit.mjs";

const source = new URL("../../", import.meta.url);
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function tree(files) {
  return {
    read: (path) => files[path] ?? null,
    list: (dir) => [...new Set(Object.keys(files).filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1).split("/")[0]))],
  };
}

function gitIn(root) {
  return (...args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "-C", root, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function fixture(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = gitIn(root);
  git("init", "-q");
  return { root, git, write: (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); } };
}

test("every external commit this repository pins is listed in the reviewed pins", () => {
  const pins = collectPins();
  // An empty read proves nothing: the repository pins workflows, skills and runtime sources today.
  for (const kind of ["workflow", "skill", "runtime"]) assert.ok(pins.some((pin) => pin.kind === kind), `no ${kind} pin was read`);
  assert.ok(pins.some((pin) => pin.repository === "dinkuskit/clawsweeper"), "the reusable workflow pin was not read");
  const { reviewed } = JSON.parse(readFileSync(new URL(REVIEWED_PINS, source), "utf8"));
  assert.deepEqual(auditPins(pins, reviewed), []);
});

test("workflow, skill and runtime pins are all read, and this repository's own actions are not", () => {
  const pins = collectPins(tree({
    ".github/workflows/ci.yml": [
      "jobs:",
      "  build:",
      "    steps:",
      `      - uses: actions/checkout@${A} # v9`,
      "      - name: Chromium",
      "        uses: ./.github/actions/setup-chromium",
      "      - uses: actions/cache@v4",
      "  review:",
      `    uses: "dinkuskit/clawsweeper/.github/workflows/review.yml@${B}"`,
    ].join("\n"),
    ".github/workflows/notes.md": `uses: actions/ignored@${C}`,
    ".github/actions/setup-chromium/action.yml": `    - id: cache\n      uses: actions/cache@${C}\n`,
    "scripts/agent-skills": `SAARIUS_REPO="https://github.com/saariuslystoned/SaariusSkills.git"\nSAARIUS_SHA="${A}"\nEMDASH_COMMERCE_SHA="${B}"\n`,
    "package.json": JSON.stringify({
      dinkuskit: {
        sourcePins: { commerce: { repository: "https://github.com/dinkuskit/commerce.git", tag: "v1.0.0", commit: A } },
        playgroundPlugins: { ship: { repository: "https://github.com/dinkuskit/ship.git", commit: B } },
      },
      dependencies: { "@dinkuskit/inventory": `github:dinkuskit/inventory#${C}`, astro: "7.1.3" },
      devDependencies: { "@dinkuskit/courier": "git+https://github.com/dinkuskit/courier.git#main" },
    }),
  }));
  assert.deepEqual(pins.map((pin) => `${pin.kind} ${pin.repository}@${pin.commit}`), [
    `workflow actions/checkout@${A}`,
    "workflow actions/cache@v4",
    `workflow dinkuskit/clawsweeper@${B}`,
    `workflow actions/cache@${C}`,
    `skill saariuslystoned/SaariusSkills@${A}`,
    `skill saariuslystoned/SaariusSkills@${B}`,
    `runtime dinkuskit/commerce@${A}`,
    `runtime dinkuskit/ship@${B}`,
    `runtime dinkuskit/inventory@${C}`,
    "runtime dinkuskit/courier@main",
  ]);
  assert.equal(pins[0].where, ".github/workflows/ci.yml:4");
  assert.equal(pins[4].where, "scripts/agent-skills SAARIUS_SHA");
  assert.equal(pins[6].where, "package.json dinkuskit.sourcePins.commerce");
});

test("a pin fails unless its full commit is listed, with a review note, under its own source repository", () => {
  const pin = (repository, commit) => ({ kind: "workflow", repository, commit, where: "ci.yml:1" });
  const reviewed = { "actions/checkout": { [A]: "reviewed in #1", [C]: " " }, "actions/cache": { [B]: "reviewed in #2" } };
  assert.deepEqual(auditPins([pin("actions/checkout", A), pin("actions/cache", B)], reviewed), []);
  // A commit reviewed for another repository, an unlisted commit, an empty note and a movable tag all fail.
  assert.match(auditPins([pin("actions/checkout", B)], reviewed)[0], new RegExp(`^ci\\.yml:1: actions/checkout@${B} is not listed in \\.github/reviewed-pins\\.json`, "u"));
  assert.equal(auditPins([pin("pnpm/action-setup", A)], reviewed).length, 1);
  assert.equal(auditPins([pin("actions/checkout", C)], reviewed).length, 1);
  assert.equal(auditPins([pin("constructor", "name")], reviewed).length, 1);
  assert.match(auditPins([pin("actions/checkout", "v4")], { "actions/checkout": { v4: "reviewed" } })[0], /actions\/checkout@v4 is not pinned to a full commit$/u);
  assert.match(auditPins([pin("docker://alpine:3", "")], reviewed)[0], /@\(nothing\) is not pinned to a full commit$/u);
});

test("a moved pin is compared with what its repository was pinned to before, a new one with nothing", () => {
  const pin = (repository, commit) => ({ kind: "runtime", repository, commit, where: "package.json" });
  const base = [pin("dinkuskit/commerce", A), pin("dinkuskit/ship", A)];
  assert.deepEqual(pinChanges(base, base), []);
  assert.deepEqual(pinChanges(base, [pin("dinkuskit/commerce", B), pin("dinkuskit/commerce", B), pin("dinkuskit/ship", A), pin("dinkuskit/reviews", C)]), [
    { repository: "dinkuskit/commerce", from: A, to: B },
    { repository: "dinkuskit/reviews", from: EMPTY_TREE, to: C },
  ]);
});

test("pinned commits are fetched from their source repository and each moved pin's source diff is written", (t) => {
  const upstream = fixture(t, "pin-audit-source-");
  upstream.git("config", "uploadpack.allowAnySHA1InWant", "true");
  upstream.write("action.yml", "runs: reviewed\n");
  upstream.git("add", ".");
  upstream.git("commit", "-qm", "Reviewed");
  const from = upstream.git("rev-parse", "HEAD");
  upstream.write("action.yml", "runs: changed after review\n");
  upstream.git("commit", "-qam", "Moved");
  const to = upstream.git("rev-parse", "HEAD");
  const out = mkdtempSync(join(tmpdir(), "pin-audit-out-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const pins = [{ kind: "workflow", repository: "example/action", commit: to, where: "ci.yml:1" }];
  const changes = [{ repository: "example/action", from, to }, { repository: "example/action", from: EMPTY_TREE, to }];

  assert.deepEqual(resolvePins({ pins, changes, out, remote: () => upstream.root }), []);
  const moved = readFileSync(join(out, "diffs", `example__action__${from.slice(0, 12)}..${to.slice(0, 12)}.diff`), "utf8");
  assert.match(moved, /^-runs: reviewed$/mu);
  assert.match(moved, /^\+runs: changed after review$/mu);
  assert.match(readFileSync(join(out, "diffs", `example__action__new..${to.slice(0, 12)}.diff`), "utf8"), /^\+runs: changed after review$/mu);
  assert.equal(readdirSync(join(out, "diffs")).length, 2);

  // A commit its named repository does not have is refused, not skipped.
  assert.deepEqual(resolvePins({ pins: [{ ...pins[0], commit: C }], out, remote: () => upstream.root }), [`example/action@${C} does not resolve in ${upstream.root}`]);
});

test("the audit command passes listed pins and fails a change that moves a pin without listing it", (t) => {
  const store = fixture(t, "pin-audit-store-");
  mkdirSync(join(store.root, ".github/scripts"), { recursive: true });
  copyFileSync(new URL(".github/scripts/pin-audit.mjs", source), join(store.root, ".github/scripts/pin-audit.mjs"));
  const manifest = (commit) => `${JSON.stringify({ type: "module", dependencies: { "@dinkuskit/inventory": `github:dinkuskit/inventory#${commit}` } })}\n`;
  store.write("package.json", manifest(A));
  store.write(REVIEWED_PINS, `${JSON.stringify({ reviewed: { "dinkuskit/inventory": { [A]: "reviewed in #1" } } })}\n`);
  store.git("add", ".");
  store.git("commit", "-qm", "Reviewed pin");
  const base = store.git("rev-parse", "HEAD");
  const run = () => spawnSync(process.execPath, [join(store.root, ".github/scripts/pin-audit.mjs"), "--base", base], { encoding: "utf8" });

  const listed = run();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^pin audit: 1 pins, each listed in \.github\/reviewed-pins\.json$/mu);

  store.write("package.json", manifest(B));
  store.git("commit", "-qam", "Move the pin");
  const moved = run();
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, new RegExp(`^pin audit: moved dinkuskit/inventory ${A} -> ${B}$`, "mu"));
  assert.match(moved.stderr, new RegExp(`dinkuskit/inventory@${B} is not listed in \\.github/reviewed-pins\\.json`, "u"));
});
