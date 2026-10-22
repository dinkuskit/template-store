import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Moves each playground plugin pin in package.json to that plugin's latest
// stable GitHub release (prereleases are never picked), by exact tag and
// commit. The "Update playground plugins" workflow opens the result as a PR,
// so every bump gets its own preview and review before it goes live.

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "package.json");
const source = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(source);
const pins = manifest.dinkuskit?.playgroundPlugins ?? {};

async function latestStableTag(name) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "dinkuskit-template-store" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/dinkuskit/${name}/releases/latest`, { headers });
  if (!response.ok) throw new Error(`Could not read the latest ${name} release (HTTP ${response.status}).`);
  const release = await response.json();
  if (release.prerelease || release.draft || !/^v\d+\.\d+\.\d+$/u.test(release.tag_name)) {
    throw new Error(`The latest ${name} release ${release.tag_name} is not a stable vX.Y.Z release.`);
  }
  return release.tag_name;
}

function tagCommit(repository, tag) {
  const result = spawnSync("git", ["ls-remote", repository, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ls-remote failed for ${repository} ${tag}.`);
  const lines = result.stdout.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
  // An annotated tag lists its commit on the ^{} line; a lightweight tag only has the first.
  const peeled = lines.find(([, ref]) => ref.endsWith("^{}")) ?? lines[0];
  if (!peeled || !/^[0-9a-f]{40}$/u.test(peeled[0])) throw new Error(`${repository} has no commit for ${tag}.`);
  return peeled[0];
}

const changes = [];
for (const [name, pin] of Object.entries(pins)) {
  const tag = await latestStableTag(name);
  if (tag === pin.tag) {
    console.log(`playground plugins: ${name} stays at ${tag}`);
    continue;
  }
  const commit = tagCommit(pin.repository, tag);
  changes.push(`${name} ${pin.tag} -> ${tag}`);
  pin.tag = tag;
  pin.commit = commit;
  console.log(`playground plugins: ${name} moves to ${tag} (${commit.slice(0, 12)})`);
}

if (changes.length > 0) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changes.length > 0}\nsummary=${changes.join(", ")}\n`);
}
