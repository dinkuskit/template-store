# Classic merchandise catalog first slice

Status: implemented locally on `feat/merch-catalog-foundation` (2026-09-25).

The existing EmDash seed now owns a `merchandise` collection alongside Pages.
A human can edit the hero in Pages `home`, and each card's display title,
collection name, description, and visual placeholder label in Merchandise.
Published entries are grouped by their collection name into the in-page
navigation and responsive grid. No product-card editorial field contains a
quantity or price; connected prices are read from Commerce.

Connected availability is bound in code only for the exact seed entry IDs:
`everyday-tee` reads the existing Commerce + Inventory managed product and
`canvas-cap` reads the existing Commerce manual-availability product. Every
other entry is a non-purchasable preview, regardless of its editable title,
category, description, or illustration style. No EmDash field can promote an
arbitrary card into a connected product. Those two Commerce identities and
their availability are still provisioned by demo runtimes; a future Commerce
admin UI must own merchant changes to them. The local, original garment SVGs
are generic catalog illustrations, not product photography. This is a visual
scaffold, not production-ready merchandising.

The implementation uses EmDash's own collection/seed and the existing Dinkus
Blocks, Commerce, and Inventory contracts. No additional storefront library is
needed for a static grouped grid; no new package or pin was added.

Verification remains `pnpm verify`: desktop and mobile browser proof observes
the real `8 → 5 → 8` managed stock sequence and the unmanaged manual-availability
cycle, while asserting collection navigation, preview non-purchasability, and
catalog-card availability changes. This is not a checkout or deployment claim.

## Local proof (2026-09-25)

`pnpm verify` runs the full Node 22 verifier, including desktop and mobile
Chromium. Catalog screenshots and assertions are in ignored
`runs/merch-catalog-20260925/browser/{chromium-desktop,chromium-mobile}/`:
`admin-merch-item.png`, `public-catalog.png`, and `assertions.json`. Both
public screenshots were directly inspected after the SVG change: tee, hoodie,
cap, and beanie illustrations render; categories and preview labels remain
legible without horizontal overflow. The browser also checks all five SVGs
load, the exact connected entry IDs, and absence of purchase links on previews.
The page still includes two large integration-proof panels below the catalog;
this is a local starter scaffold, not a production-ready retail design.

## Collection and product browse slice

The catalog now links to server-rendered `/collections/<name-slug>-<digest>` and
`/products/<entry-id>` pages. Collection URL digests distinguish editorial names
that normalize to the same slug; product URLs use immutable, URL-safe EmDash
entry IDs rather than editable titles. Invalid IDs are omitted from the catalog.
Both routes look up published Merchandise entries only and return 404 for
missing or draft entries. Category names, descriptions, titles, and illustration
styles remain editable in EmDash.

Product pages read current Commerce + Inventory managed availability for the
exact `everyday-tee` ID and Commerce manual availability for the exact
`canvas-cap` ID. Every other ID remains an explicitly non-purchasable preview,
regardless of CMS fields. Connected pages present Commerce Regular/Sale only when listable; an unpriced Commerce product stays off the public home. No page presents a cart or checkout. The
homepage's compact availability summaries and existing proof sequence remain.
Browser proof covers catalog → collection → product → collection → catalog,
preview details, and a managed status change visible on the product page.

Final local proof: `NO_PROXY=127.0.0.1,localhost,::1` and
`no_proxy=127.0.0.1,localhost,::1`, then
`mise x node@22.23.2 -- pnpm verify`. The full verifier runs Astro check,
Vitest, workflow/feature/text audits, build, and desktop/mobile Chromium.
Screenshots live in ignored `runs/merch-catalog-20260925/browser/`
(`public-collection.png`, `public-product.png`, `public-cap-product.png`),
with the managed 5-available product change in
`runs/managed-product-availability-20260829/browser/*/product-changed.png`.
