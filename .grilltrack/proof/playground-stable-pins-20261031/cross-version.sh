#!/bin/bash
# One visitor store set up on main's Playground build (Payments 0.4.0, Ship 0.3.0, Commerce
# 0.7.0-beta.4), then served by this PR's build (Payments 0.5.0, Ship 0.3.1, Commerce 0.7.0).
#
# Both builds run under `wrangler dev` on https://127.0.0.1 (port 443, so Payments accepts the
# site origin) with one --persist-to directory, so the second Worker opens the same visitor
# Durable Object the first one wrote. The cookie jar keeps the visitor's session across both.
#
# Usage, from the repository root, with OLD and NEW holding `dist/` copies of
# `pnpm prepare:sources && pnpm exec astro build --config astro.playground.config.mjs`
# at main and at this PR's head:
#   cross-version.sh old   # start main's build, then run the "old" steps below
#   cross-version.sh new   # start this PR's build on the same state, then run the "new" steps
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
state="${STATE:-${TMPDIR:-/tmp}/playground-cross-version-state}"
jar="${TMPDIR:-/tmp}/playground-cross-version.jar"
build="${1:?old or new}"; dist="${OLD:?}"; [ "$build" = new ] && dist="${NEW:?}"
[ "$build" = old ] && { rm -rf "$state" "$jar"; mkdir -p "$state"; }
setsid pnpm exec wrangler dev --config "$dist/server/wrangler.json" --persist-to "$state" --port 443 --ip 127.0.0.1 \
  --local --local-protocol https --upstream-protocol https --show-interactive-dev-session=false > "${TMPDIR:-/tmp}/wrangler-$build.log" 2>&1 &
worker=$!; trap 'kill -- -$worker 2>/dev/null || true' EXIT
until grep -q "Ready on" "${TMPDIR:-/tmp}/wrangler-$build.log"; do sleep 2; done
D="python3 -I $here/drive.py https://127.0.0.1 $jar"; P=r_3brsc2on3bu673rn; S=r_ehdlg5cxkb3ffqvr; T=dinkus-playground-tour
if [ "$build" = old ]; then
  $D get / >/dev/null; $D get / >/dev/null; $D init >/dev/null
  $D admin $P '{"type":"block_action","page":"/status","action_id":"connect"}' >/dev/null
  echo "### old build: Payments Continue"; $D admin $P '{"type":"block_action","page":"/status","action_id":"continue"}' | sed -n 2,4p
  echo "### old build: Ship page"; $D admin $S '{"type":"page_load","page":"/shipping"}' | sed -n 2,4p
  echo "### old build: Ship Connect"; $D admin $S '{"type":"block_action","page":"/shipping","action_id":"connect"}' | sed -n 2,4p
  echo "### old build: Ship Check"; $D admin $S '{"type":"block_action","page":"/shipping","action_id":"check"}' | sed -n 2,6p
  echo "### old build: practice label"; $D admin $S '{"type":"form_submit","page":"/shipping","action_id":"buy:1:playground-sample-paid","values":{"boxId":"small","weightOz":"28","service":"GA","kind":"practice"}}' | grep -E "Tracking number|toast|Status"
  echo "### old build: tour card"; $D admin $T '{"type":"page_load","page":"widget:tour"}' | sed -n 2,3p
else
  echo "### new build, same visitor store: tour card before any action"; $D admin $T '{"type":"page_load","page":"widget:tour"}' | sed -n 2,3p
  echo "### new build: Payments page load (no reconnect)"; $D admin $P '{"type":"page_load","page":"/status"}' | sed -n 2,6p
  echo "### new build: Payments Check connection"; $D admin $P '{"type":"block_action","page":"/status","action_id":"check"}' | sed -n 2,4p
  echo "### new build: Ship page load (no reconnect)"; $D admin $S '{"type":"page_load","page":"/shipping"}' | sed -n 2,6p
  echo "### new build: open the labelled order"; $D admin $S '{"type":"block_action","page":"/shipping","action_id":"open","value":"playground-sample-paid"}' | grep -E "Tracking number|Status|Cancel label"
  echo "### new build: tour page words"; $D admin $T '{"type":"page_load","page":"/tour"}' | grep -oE "Open (Payment settings|Shipments|Payments|Shipping)[^|]{0,40}" | sort -u
  # The cancel names the label id the order page above printed (practice_...).
  label="$($D admin $S '{"type":"block_action","page":"/shipping","action_id":"open","value":"playground-sample-paid"}' | grep -oE "practice_[A-Za-z0-9]+" | head -1)"
  echo "### new build: cancel the old build's practice label"; $D admin $S "{\"type\":\"block_action\",\"page\":\"/shipping\",\"action_id\":\"cancel:playground-sample-paid\",\"value\":\"$label\"}" | grep -E "toast|\"Status\"" | head -3
  attempt="$($D admin $S '{"type":"block_action","page":"/shipping","action_id":"open","value":"playground-sample-paid"}' | grep -oE 'buy:[0-9]+:playground-sample-paid' | head -1)"
  echo "### new build: make a new practice label on the same order ($attempt after the cancel)"; $D admin $S "{\"type\":\"form_submit\",\"page\":\"/shipping\",\"action_id\":\"$attempt\",\"values\":{\"boxId\":\"medium\",\"weightOz\":\"32\",\"service\":\"PM\",\"kind\":\"practice\"}}" | grep -oE '"Tracking number", "value": "[^"]+"|toast .*|Earlier labels \([0-9]+\)'
  echo "### new build: tour page"; $D admin $T '{"type":"page_load","page":"/tour"}' | grep -oE "[0-9] of 4 steps done" | sort -u
fi
