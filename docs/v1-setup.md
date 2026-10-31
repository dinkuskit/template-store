# TemplateStore v1 setup and upgrades

Status: source-pilot preparation; the matching released pair is pending.

## For a shop owner

Use the approved TemplateStore release and its matching Commerce release together.
The final release instructions must identify both artifacts exactly. A host should
install that pair and open EmDash setup for you; you should not need to wire
separate Inventory workers or repositories. No released install command or hosted
installer is available in this candidate.

In EmDash setup, choose your site identity and administrator. Open Products, add
Name and SKU, then set Regular to list the product. A lower Sale displays a discount.
An unset Regular keeps the product in admin and hides it publicly; zero is a valid
free price. Reload Shop and open its product page. Commerce owns price and availability.
The current pin edits manual availability through an authenticated Commerce API;
a visual status control and disabled Manage stock / Coming soon must be proved
with the final Commerce artifact. These are current onboarding gaps.

Inventory is off for shipping v1. There is no quantity, stock ledger, Inventory
service, or provider setup to complete. Existing managed products stay managed
and fail closed without their provider; the template never converts their data.
Purchasing, orders, payment and shipping require the release gates in
[v1-pairing.md](v1-pairing.md). A working catalog does not mean a working store.

## Current local developer pilot

Use this exact candidate source checkout, Node 24 and the checked-in pnpm lockfile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Astro and `/_emdash/admin`. This prepares exact Commerce
source automatically; source aliases remain temporary integration mechanics.
The default storefront consumes installed Commerce `catalog/public`. With the
pinned Commerce's Registry bundle prepared (`pnpm prepare:commerce`), `pnpm dev`
mounts it as a Registry store installs it (template-one-build-registry-20261031);
without a mounted or installed Commerce, Shop fail-closes and invents no products.
The native copy's `DINKUS_CATALOG_PROFILE=native-development` is retired.
The default storefront does not bootstrap integration stock demonstrations.
Use the explicit integration profile only for development regression verification:

```sh
DINKUS_STOREFRONT_PROFILE=proof pnpm dev
```

This enables the demonstration presentation; proof mutations additionally require
the dedicated verifier's proof mode. `DINKUS_PROOF_MODE` alone does not select
the presentation profile.
`pnpm verify` must cover both default-profile and managed-development journeys.
Never expose proof mutation or dev authentication on a hosted demo.

## Existing installations

Back up the database and uploads before changing the pair. Keep the current data
paths and CMS content. Do not reapply seed with update, reset the database, convert
managed records, or copy demonstration products into persisted Commerce storage.
Ryan decided that the #34 schema change is an intentional breaking upgrade:
no template-store site accepts real orders, so there is no live-store migration
path to preserve. An initialized database that still has `merchandise` fails
closed under the new template: `products` and `categories` are absent, so no
canonical product pages are published and no old record is guessed or converted.
This is an explicit unavailable/empty catalog state, not a blank fallback or a
startup crash.

For a local site, export any copy worth keeping, back up the database and
uploads, then reseed or re-bootstrap from the current `seed/seed.json`. Review
Products, Collections, and Pages after setup and re-enter retained editorial
copy in the new schema. Do not run an automatic `merchandise` → `products`
migration, use seed `update`, or claim this procedure preserves an initialized
site automatically. Existing sites accepting real orders do not exist.
Source-pilot proof covers EmDash 0.41.0 only; EmDash 1.0 and the final artifact
need a fresh clean-install and upgrade proof before release instructions exist.

Later additive schema changes apply themselves (GrillTrack
template-store-self-upgrade-20261028). On the first request after a deploy, a
store runs each storefront upgrade in
`src/features/store-shell/storefront-upgrades.ts` that its database, D1 or
SQLite, has not recorded, after EmDash's own migrations, and records it in the
`dinkus:storefront-upgrades` option. It waits until EmDash has seeded the store
or the owner has set it up, so a brand-new store gets the seed's schema
untouched. A step only adds or relaxes and keeps owner edits; a failed step
never fails the request and is retried a minute later.
`EMDASH_MIGRATIONS_MODE=manual` or `check` turns it off with EmDash's own
migrations. A template change to the schema in `seed/seed.json` adds its step to
that list in the same change.

EmDash treats a template as a copied Astro project; its seed initializes a new
site and is not a deployed-site migration system. [Official theme contract](https://docs.emdashcms.com/themes/overview/).
