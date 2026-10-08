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

Use this exact candidate source checkout, Node 22 and the checked-in pnpm lockfile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Astro and `/_emdash/admin`. This prepares exact Commerce
source automatically; source aliases remain temporary integration mechanics.
The default storefront consumes installed Commerce `catalog/public`. Without a
paired installed artifact, Shop fail-closes and invents no products. Native
Products admin and storage reads require
`DINKUS_CATALOG_PROFILE=native-development`.
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
Upgrade the template and Commerce as one tested pair, then check Products edits,
price clearing, manual availability and existing managed fail-closed behavior.
Existing Pages and section copies keep their edited copy and links. If upgrading
from the integration pilot, review Home in EmDash Pages: update its Shop actions
to `#commerce-catalog` and remove stale demo/Inventory claims before presenting
the default profile. Stock demonstration links are development-only. The fresh
seed correction does not rewrite an initialized site.
Source-pilot proof covers EmDash 0.41.0 only; EmDash 1.0 and the final artifact
need a fresh clean-install and upgrade proof before release instructions exist.

EmDash treats a template as a copied Astro project; its seed initializes a new
site and is not a deployed-site migration system. [Official theme contract](https://docs.emdashcms.com/themes/overview/).
