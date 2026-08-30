import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const failures = [];

for (const path of paths) {
  const contents = readFileSync(path);
  if (contents.includes(0)) continue;

  const text = contents.toString("utf8");
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (/[\t ]+$/u.test(lines[index])) {
      failures.push(`${path}:${index + 1}: trailing whitespace`);
    }
  }
  if (text.endsWith("\n\n")) {
    failures.push(`${path}: blank line at end of file`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`worktree text audit: ${failure}`);
  process.exit(1);
}

console.log("worktree text audit: ok");
