#!/usr/bin/env node
// Decides whether a pull request needs the browser tests. A change that only
// touches records and docs (GrillTrack, changesets, docs/ and top-level
// Markdown) skips them; every other change, and every push to main, runs them.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RECORD_ONLY = [/^\.grilltrack\//, /^\.changeset\//, /^docs\//, /^[^/]+\.md$/];

export function needsBrowser(paths) {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  // An empty or unreadable diff runs everything.
  return changed.length === 0 || changed.some((path) => !RECORD_ONLY.some((pattern) => pattern.test(path)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`browser=${needsBrowser(readFileSync(0, "utf8").split("\n"))}`);
}
