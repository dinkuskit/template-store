#!/usr/bin/env bash
# A disposable local store on a fresh database, running Commerce's Registry build the way a Registry store
# installs it (template-one-build-registry-20261031): EmDash's documented loop, the plugin built, the site
# run with astro dev, whose workerd runner hands the plugin to Miniflare. The proof storefront profile seeds
# the demo catalog on the first request. DINKUS_PAIRED_COMMERCE_DIR points it at a Commerce checkout you are
# building instead of the pinned release.
set -euo pipefail

if [ "${DINKUS_CATALOG_PROFILE:-}" = "native-development" ]; then
  echo "dev:fresh: DINKUS_CATALOG_PROFILE=native-development is retired; the store runs Commerce's Registry build. Unset it." >&2
  exit 2
fi

port="${DINKUS_DEV_PORT:-4321}"
rm -rf .artifacts/dev
mkdir -p .artifacts/dev/uploads
pnpm prepare:sources
node scripts/prepare-paired-commerce.mjs

export DINKUS_STOREFRONT_PROFILE="${DINKUS_STOREFRONT_PROFILE:-proof}"
export EMDASH_SITE_URL="${EMDASH_SITE_URL:-http://127.0.0.1:$port}"
exec pnpm exec astro dev --host 127.0.0.1 --port "$port"
