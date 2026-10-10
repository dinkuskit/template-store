#!/usr/bin/env bash
# Prepares a Claude Code cloud session for Template Store work: the .nvmrc
# Node and packageManager pnpm, the sqlite3 CLI, a frozen lockfile install,
# the pinned Commerce source, the pinned agent skills, and the Chromium build
# the locked Playwright expects. Local sessions are left alone. Every step is idempotent
# and a failed step is reported, not fatal, so the session still starts and
# can say what is missing.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$root" || exit 0

status=()
report() {
  printf 'Template Store cloud session setup:\n'
  printf -- '- %s\n' "${status[@]}"
}

# Node: AGENTS.md pins .nvmrc; prefer an nvm install of it when PATH has another.
want="v$(tr -d '[:space:]' < .nvmrc)"
nvm_bin="$HOME/.nvm/versions/node/$want/bin"
if [ "$(node -v 2>/dev/null)" != "$want" ] && [ -x "$nvm_bin/node" ]; then
  export PATH="$nvm_bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'export PATH="%s:$PATH"\n' "$nvm_bin" >> "$CLAUDE_ENV_FILE"
fi
have="$(node -v 2>/dev/null || echo none)"
want_pnpm="$(node -p 'require("./package.json").packageManager.split("@")[1]' 2>/dev/null)"
have_pnpm="$(pnpm -v 2>/dev/null || echo none)"
if [ "$have" != "$want" ] || [ "$have_pnpm" != "$want_pnpm" ]; then
  status+=("node $have / pnpm $have_pnpm do not match .nvmrc $want / packageManager pnpm $want_pnpm; dependencies were not installed. Fix the cloud environment's setup script.")
  report
  exit 0
fi
status+=("node $have (pnpm $have_pnpm)")

# sqlite3 CLI: scripts/scheduled-index-harness.mjs shells out to it, and CI's
# Ubuntu runner already has it.
if command -v sqlite3 >/dev/null 2>&1; then
  status+=("sqlite3 present")
elif [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null 2>&1 &&
  { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sqlite3; } >&2; then
  status+=("sqlite3 installed with apt-get, as on CI's Ubuntu runner")
else
  status+=("sqlite3 is missing and could not be installed; the scheduled-index seed test will fail")
fi

# Dependencies: frozen pnpm install, skipped when node_modules was already
# installed from this exact lockfile with this Node and pnpm.
stamp_file=node_modules/.session-start-stamp
stamp="$have $have_pnpm $(sha256sum pnpm-lock.yaml | cut -d' ' -f1)"
if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$stamp" ]; then
  status+=("dependencies already match pnpm-lock.yaml")
elif pnpm install --frozen-lockfile >&2; then
  printf '%s' "$stamp" > "$stamp_file"
  status+=("dependencies installed with pnpm install --frozen-lockfile")
else
  # Cloud sessions fetch github: dependency tarballs only for repositories
  # attached to the session, so name them.
  github_deps="$(node -p 'const p = require("./package.json"); Object.values({...p.dependencies, ...p.devDependencies}).filter((s) => s.startsWith("github:")).map((s) => s.slice(7).split("#")[0]).join(", ")' 2>/dev/null)"
  status+=("pnpm install --frozen-lockfile failed; see the hook output. Do not regenerate the lockfile to fix it.${github_deps:+ A 403 from codeload.github.com means the repository of a github: dependency is not attached to this session; start the session with ${github_deps} selected too.}")
fi

# The exact Commerce commit package.json pins, under ignored .artifacts/. Run
# the script itself: pnpm would first re-check the install above.
if node scripts/prepare-source-deps.mjs >&2; then
  status+=("Commerce source prepared at the package.json pin")
else
  status+=("pnpm prepare:sources failed; typecheck, tests and builds need it")
fi

# Pinned GrillTrack and EmDash skills into the ignored .cursor/skills/.
if ./scripts/agent-skills >&2; then
  status+=("GrillTrack CLI and EmDash skills installed (./scripts/grilltrack --project . validate)")
else
  status+=("./scripts/agent-skills failed; GrillTrack ledger reads are unavailable")
fi

# Browser for test:e2e and pnpm verify: whatever the locked Playwright CLI names.
if [ -x node_modules/.bin/playwright ]; then
  plan="$(node_modules/.bin/playwright install --dry-run chromium 2>/dev/null)"
  revision="$(sed -n 's/.*(playwright chromium \(v[0-9]*\)).*/\1/p' <<< "$plan" | head -n 1)"
  missing=0
  while read -r location; do
    [ -d "$location" ] || missing=1
  done < <(sed -n 's/^ *Install location: *//p' <<< "$plan")
  if [ -z "$plan" ]; then
    status+=("could not read the locked Playwright's browser plan")
  elif [ "$missing" = 0 ]; then
    status+=("Playwright chromium $revision present")
  elif timeout 600 node_modules/.bin/playwright install chromium >&2; then
    status+=("Playwright chromium $revision installed")
  else
    status+=("Playwright chromium $revision missing and its download failed; the network policy must allow cdn.playwright.dev and playwright.download.prss.microsoft.com. verify:quick works; pnpm verify (full) will not")
  fi
fi

report
exit 0
