# One Commerce build: the Registry build everywhere in the Template Store

Covers `template-one-build-registry-20261031`. Ronald locked it on 31 Oct 2026
("lock it"): Commerce runs ONE build, the Registry (sandboxed) one, everywhere.
The Template Store's local dev, its public demo and its CI browser tests leave
Commerce's native copy (`DINKUS_CATALOG_PROFILE=native-development`, Commerce
`src/index.ts`) for the Registry bundle mounted through EmDash's
`sandboxed: [...]`, EmDash's documented loop: build the plugin, run the site.

## What changed

- **The paired Commerce** (`scripts/lib/paired-commerce.mjs`,
  `pnpm prepare:commerce`). The pin in `package.json`
  (`dinkuskit.sourcePins.commerce`, the `v0.7.0` release,
  `4c975824923626e52460d6fbad29d5e32613a319`) is fetched and built once per
  commit under `.artifacts/paired-commerce/<commit>` the way
  `scripts/verify-paired-product-on-sale.mjs` already did; that proof now shares
  the library and still checks the recorded release digests
  (`dist/sandbox/plugin.mjs` `a630ca23…`, `dist/sandbox/index.mjs` `2f2fc69e…`,
  the bytes the Registry serves). `DINKUS_PAIRED_COMMERCE_DIR` points the store
  at a Commerce checkout being developed (built with `npm run build` there);
  set empty it means none. A pre-release pin mounts under the beta package's
  runtime id (`r_fjzjvld3ssb4j63o`), a release under the stable one.
- **`astro.config.mjs`**. The native `dinkusCommerce()` mount and
  `enableLocalStockManagement` are gone; `native-development` is refused with
  the fix. The paired build is mounted as `sandboxed: [descriptor]` under the
  Registry runtime id, with `@emdash-cms/sandbox-workerd/sandbox` on Node
  (`astro dev` hands it to Miniflare) and EmDash's Cloudflare sandbox on
  Cloudflare, where the Wrangler config must bind `LOADER`; a Cloudflare host of
  the installed Commerce gets the Registry profile's 32-subrequest runner
  (registry-sandbox-budget-002). A Registry store build
  (`scripts/build-registry.mjs`) bundles none: its owner installs Commerce.
- **Local dev**. `pnpm dev` mounts the prepared pin; `pnpm dev:fresh` is a
  fresh SQLite store on `astro dev` with the proof storefront profile.
- **The demo Worker** (`wrangler.jsonc`). `worker_loaders: [{ binding: "LOADER" }]`,
  `DINKUS_CATALOG_PROFILE=shipping`, `DINKUS_COMMERCE_PROFILE=stable` (the pin's
  package; a workflow test keeps it in step). `pnpm build` prepares the pin and
  bundles it. The demo's Cloudflare account already runs Workers with a
  `worker_loader` binding, so the plan allows it.
- **Demo catalog** (`src/features/playground/demo-registry-seed.ts`). The demo
  store (proof storefront profile) seeds its nine products (ten SKUs) through the
  installed Commerce's own private routes as an Administrator: each product's
  page first, then `catalog` `create` for the page, `choice` for the hoodie's
  Color and Size, `prices` with stock status, and `catalog-items/set-on-sale`,
  as the page's publish records it. Create-only-if-missing by SKU. It runs on
  the first request EmDash hands its full runtime to (a signed-in person's);
  a fresh install's first attempts are refused until Commerce's unique indexes
  exist (about a minute) and are retried. The D1 seeder, its scheduled-index
  harness and seed bundle, which wrote the native copy's `dinkus-commerce`
  camelCase collections directly, are removed with that copy.
- **Browser tests**. The proof store (`scripts/start-e2e-server.mjs`,
  `playwright.config.ts`, `bin/verify-web`, CI cache keyed on the pin) mounts
  the paired build; the shipping store mounts no Commerce. Specs speak only the
  Registry's routes: the product panel, `catalog` (`create` for a page,
  `prices` with stock status, `identifiers`, `media`, `feeds`, `list`), the
  publish check, the public reads (`tests/e2e/helpers/product-page.ts`:
  `COMMERCE_ID`, `catalogOp`, `sellProduct`, `setStockStatus`). Products sell
  from their pages, so Add to cart is proved on the product page, which now
  offers the guest cart on the demo store with checkout closed
  (hosted-demo-007); the public catalog projects the price the shopper pays, so
  the shop shows a sale price alone. The shopper-account browser proof is the
  playground's instant-demo flow and is skipped until the playground's own
  switch (its HTTP proof stays).
- **Still native: the playground only**, per playground-commerce-until-part-2-20261022
  and playground-commerce-050-source-first-20261023 (its own PR). The storefront's
  `native-development` branches serve it alone and say so.

## Gaps this exposes (for Ronald)

- The Registry build has no route that writes a store policy
  (`settings/shipping-policy`, `settings/return-policy` were native only), so
  `policies/public` reads collections nothing writes; `/shipping` and `/returns`
  stay in their unset state. Policy editing needs a Commerce decision.
- The demo has no baseline reset for the Registry build; the seed never changes
  an existing product.

## Observed

The branch started on the `v0.7.0-beta.4` pin and rebased onto main's `v0.7.0`
pin (dinkuskit/template-store#183) before the final runs; the two builds'
`dist/sandbox/plugin.mjs` are byte-identical (`a630ca23…`), `index.mjs` differs
only in its version string. Node 24.22.0, pnpm 11.9.0, this cloud container.

| Check | Pin | Result |
| --- | --- | --- |
| `node scripts/prepare-paired-commerce.mjs` | both | fetches and builds the pin; digests match the recorded release build (`a630ca23…`, `2f2fc69e…` for 0.7.0) |
| `astro dev`, proof profile, Registry build via the workerd runner | beta.4 | `Loaded sandboxed plugin r_fjzjvld3ssb4j63o`; after the first signed-in request the public catalog lists 9 products, hoodie 6 members, socks out of stock, prices as the plan; `/products/demo-shirt` shows $32.00; a fresh store's first seed attempts are refused (`unique index inactive`) and retried |
| `DINKUS_HOSTING_PROFILE=cloudflare node scripts/build-demo.mjs` | both | builds; `dist/server/wrangler.json` binds `LOADER`, vars shipping / stable (beta on the beta pin) / proof |
| `wrangler dev --local` of that build | beta.4 | the Registry plugin runs in Miniflare's local Worker Loader (its `catalog` route answers from `sandbox-plugin.js`); `catalog/public` answers under the runtime id; the demo's boundary admits a signed-in request only through Access, so the hosted demo seeds when the owner first opens the admin |
| `pnpm exec astro check` | beta.4 | 0 errors |
| `node --test tests/workflows/*.test.mjs` | both | 105 pass (beta.4 full run); the paired-commerce, demo-build-profile and offline-environment suites re-run green on 0.7.0 |
| `pnpm exec vitest run` | beta.4 | 555 pass (58 files) |
| Playwright `commerce-catalog`, `guest-cart`, `structured-data-policy-feed`, `product-page-content`, `shipping-storefront-profile` | beta.4 | pass on chromium-desktop and shipping-chromium-desktop |
| `pnpm verify:paired-product-on-sale` | 0.7.0 | 5 passed (desktop and phone), the store mounted under the stable runtime id `r_gshdrqaldna3r7sn` as the release pin selects |
| `pnpm verify` (`bin/verify-web full`) | 0.7.0 | passed: astro check, vitest 555, workflow tests, feature and worktree audits, `astro build`, Playwright 81 passed with the rest skipped by design (the shopper-account proof on both projects and the suites' own skips), verify-site 32 URLs clean |
