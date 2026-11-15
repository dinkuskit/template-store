# Remove the retired demo Worker's build (hosted-demo-retired-20261031)

Ronald (owner), 1 Nov 2026: "remove the retired demo Worker's wrangler.jsonc,
scripts/build-demo.mjs, pnpm build and their tests".

This implements the follow-up named by the locked decision
`hosted-demo-retired-20261031`: "the demo Worker's wrangler.jsonc,
scripts/build-demo.mjs, pnpm build and their tests go in a follow-up PR".

## Change

- Removed `wrangler.jsonc` (the `dinkuskit-template-demo` Worker config),
  `scripts/build-demo.mjs`, `tests/workflows/demo-build-profile.test.mjs`, and
  the `package.json` `build` / `prebuild` scripts.
- `scripts/build-registry.mjs` was the one live consumer of `build-demo.mjs`.
  It now runs `pnpm exec astro build` itself. On that path `build-demo.mjs` only
  re-read `DINKUS_CATALOG_PROFILE` / `DINKUS_COMMERCE_PROFILE` from the
  generated config, which `registryBuildEnv` already passes from
  `config.vars`. It bundled no paired Commerce, because `registryBuildEnv` sets
  `DINKUS_PAIRED_COMMERCE_DIR=""`.
- `astro.config.mjs` no longer falls back to `wrangler.jsonc`. A Cloudflare
  build without `DINKUS_WRANGLER_CONFIG` refuses to start and names
  `pnpm run build:registry`. A config without `LOADER` is refused as before.
  The selected config already went through this path.
- `scripts/verify-access-routes.mjs` audits `DEPLOY.md` and
  `wrangler.playground.jsonc` (the one committed Worker config) for plugin
  wildcards. Its test also covers a wildcard in that config.
- README, DEPLOY.md, FEATURE_MAP.md and `docs/implementation/registry-git-build.md`
  no longer describe the demo build.

Kept: the playground (`astro.playground.config.mjs`, `wrangler.playground.jsonc`),
`pnpm run build:registry`, local dev (`astro dev`, Node adapter, no Wrangler
config), the browser tests (`astro build` on the Node adapter in
`bin/verify-web` and `tests/e2e/built-unknown-fallback.spec.ts`), and the
retired demo plans kept for history.

## Acceptance to proof

| Requirement | Source | Passing case | Adverse case | Environment | Evidence |
| --- | --- | --- | --- | --- | --- |
| Demo files and `pnpm build` are gone | decision text; owner task | `git ls-files` has no `wrangler.jsonc` or `scripts/build-demo.mjs`; `package.json` has no `build` / `prebuild` | n/a | any checkout | observed in this branch |
| Registry Git build still builds shipping with LOADER | `docs/implementation/registry-git-build.md`; FEATURE_MAP | `tests/workflows/registry-build.test.mjs` (config, env, refusal) | missing inputs refuse before a build | Node 24.22.0 | 11/11 pass in session; a real `build:registry` run needs the full install (CI / Workers Builds) |
| No Cloudflare build falls back to a default config | decision; DEPLOY.md | `build:registry` sets `DINKUS_WRANGLER_CONFIG` | Cloudflare build with no config throws | full install | planned: CI; not run in session |
| Access wildcard audit still covers a committed Worker config | DEPLOY.md rule 2 | exact routes report `wildcardPluginBypass: false` | wildcard in `wrangler.playground.jsonc` reports `true` | full install (`typescript`) | passed in CI full run; blocked in session |
| Nothing else regresses | AGENTS.md required checks | `bin/verify-web full` | n/a | CI, desktop + mobile Chromium | passed in CI on cc974d9 (see below); not run in session |

## Observed in this session

- Node v24.22.0 (nvm, checksum matched), pnpm 11.9.0.
- `pnpm install --frozen-lockfile` failed: codeload returned 403 for the
  `github:dinkuskit/inventory` tarball, because the repository is not attached
  to the session with credentials. The lockfile was not touched.
- `node scripts/check-features.mjs`: `feature audit: ok`.
- `node --test tests/workflows/*.test.mjs` on this branch versus `main` in the
  same environment: 35 / 47 versus 38 / 47 (ok / not ok). The only difference
  is the three removed `demo-build-profile` tests. Every failure on both sides
  is a missing installed package (`typescript`, `csv-parse`,
  `@emdash-cms/cloudflare`, `better-sqlite3`).
- `registry-build.test.mjs` 11/11 and `registry-sandbox.test.mjs` 1/1 pass.
- `node --check` passes for the edited scripts and `astro.config.mjs`.
- `./scripts/grilltrack --project . validate`: valid.

`bin/verify-web quick` and `pnpm verify` did not run in the session.

## Observed in CI (PR #200, head cc974d9)

CI run 41350582949 on the exact implementation head:

- Store verification (desktop): `bin/verify-web full` passed. This covers
  `astro check`, vitest, `node --test tests/workflows/*.test.mjs` (so
  `access-route-policy` with the new playground-config wildcard case and
  `registry-access` ran here), `check-features`, `astro build`, and Playwright
  `shipping-chromium-desktop` (65 passed, 4 skipped). `verify-site` passed with
  0 failures and 2 sitemap skips on the test origin.
- Store verification (phone): Playwright `shipping-chromium-mobile` passed
  (64 passed, 5 skipped); `verify-web: browser passed`.
- Workflow validation, Test plan, Playground build: success.

Skipped tests are not passes. This proves source integration only. It does
not prove a real `build:registry` Workers Builds run, deployment, or released
artifact readiness.
