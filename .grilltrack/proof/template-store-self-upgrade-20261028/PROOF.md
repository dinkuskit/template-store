# Stores upgrade their own schema

Covers `template-store-self-upgrade-20261028`. Ronald asked on 28 Oct 2026, 12:24 UTC,
for the store to follow upstream EmDash and keep its data in D1.

## What changed

- `src/features/store-shell/storefront-upgrades.ts` keeps the template's storefront
  upgrades as an ordered, named list: `001_storefront_search`, `002_product_fields` and
  `003_page_addresses`. These are the steps `pnpm search:upgrade` already ran. For each
  step a store hasn't recorded, `upgradeStorefront` runs it and then records its name in
  EmDash's `options` table under `dinkus:storefront-upgrades`. When a step fails, it is
  left unrecorded and the run stops there.
- The middleware runs this on the first request each isolate serves, using EmDash's own
  database (`emdash/runtime` `getDb()`: D1 on Cloudflare, SQLite locally). It runs after
  EmDash's runtime is up, so EmDash's migrations have already been applied. It also waits
  until EmDash has seeded the store (`emdash:seed_complete`) or the owner has set it up
  (`emdash:setup_complete`), the same two options EmDash checks before it seeds a new
  store, so a seed still being written is never touched. A store with neither, or a
  failure, is tried again a minute later, and the request carries on.
  `EMDASH_MIGRATIONS_MODE=manual` or `check` leaves the store alone. The playground's
  per-visitor databases are skipped, since each one is seeded fresh.
- `pnpm search:upgrade` reruns every step on a local database and records them.
- EmDash 1.2 handles its own versioned startup work the same way. It runs pending
  migrations on the first database use per isolate (`enforceRuntimeMigrationPolicy`,
  default `auto`), and it repairs locale casing once, recorded by version in the
  `emdash:repair_locale_casing` option.

## Checks

- `tests/unit/storefront-upgrades.test.ts` covers three things on an in-memory store
  set up from the older apparel-only seed:
  - The store runs all three steps in order and records them. A later run does
    nothing, and the owner's later change stays.
  - A failed step stops the run unrecorded, and the next run starts from that step.
    `all` reruns every step.
  - The isolate runner never throws, waits a minute before trying again, shares one
    run between requests that arrive together, runs once per isolate, and stays off
    under `manual` and `check`.
  - A store EmDash hasn't seeded and nobody has set up is left alone until
    `emdash:seed_complete` appears, and then upgraded on the next try.
- `tests/unit/emdash-theme-composition.test.ts` still runs `scripts/upgrade-storefront-search.ts`
  on an on-disk older store and passes.
- Local D1 through the built Worker. This was a Cloudflare build of this source
  (`DINKUS_HOSTING_PROFILE=cloudflare pnpm build`) served by `wrangler dev --local`
  with a persisted D1. The D1 file was rewritten while no Worker ran, to hold EmDash's
  migrated tables, the apparel-only seed (`tests/fixtures/seed-before-product-categories.json`),
  the owner's finished setup (`emdash:setup_complete`) and no upgrade record.
  - Before: `visual_label` was required and labelled "Illustration style (TEE, HOODIE,
    CAP, or BEANIE)", there was no `summary` or `details`, and Pages had no address.
  - First request after start: the page answered 200, and the Worker logged
    `[storefront-upgrade] ran 001_storefront_search, 002_product_fields, 003_page_addresses`.
  - After: `visual_label` is optional with the placeholder-art label, `summary` and
    `details` exist, `collapsible_section` and `spec_table` exist, Pages has `/{slug}`,
    all 14 products are kept, and `pages`, `products` and `categories` each have search
    on with an FTS table. The option lists all three steps.
  - A new Worker start answered 200 and logged no upgrade.
- Fresh install on local D1 through the built Worker, the same build served the same way
  from an empty persisted D1 (`fresh-install.mjs` beside this file, output in
  `fresh-install.txt`):
  - First requests: `/` answered 200, and the Worker logged `Auto-seeded default
    collections` and then `[storefront-upgrade] ran 001_storefront_search,
    002_product_fields, 003_page_addresses`.
  - `/_emdash/api/setup/status` answered `needsSetup: true`, step `start`, so the
    owner's setup wizard is still offered.
  - Every collection and field (slug, type, required, label, searchable, supports,
    address) is identical to a database where EmDash alone applied `seed/seed.json` with
    no storefront upgrade. The upgrade changed nothing the seed made; it only recorded
    the three steps. The 9 seed products are there, and `pages`, `products` and
    `categories` have FTS tables.
  - With `emdash:setup_complete` then set, as EmDash's `finalizeSetup` does, a new
    Worker start answered 200 and ran nothing.
- The older-store run above (`older-store.mjs`, output in `older-store.txt`) was repeated
  on this head and gave the same result.

## Not proven here

The hosted beta store's D1 runs the same code on its first request after the deploy
that carries this change. That deploy, and a journeys run reading the new product
fields, are separate steps.
