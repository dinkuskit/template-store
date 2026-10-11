#!/usr/bin/env bash
set -euo pipefail

export DINKUS_CATALOG_PROFILE=native-development

rm -rf .wrangler/state
pnpm prepare:sources
pnpm build
node scripts/scheduled-index-harness.mjs --persist .wrangler/state/v3
pnpm seed:bundle
pnpm seed:demo

exec pnpm exec wrangler dev
