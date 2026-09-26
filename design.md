# DinkusKit Store Starter design contract

Updated: 2026-09-26
Canonical path: `design.md`

## Product intent

Provide a neutral, legible proving ground where a store builder can see EmDash
composition, Dinkus Blocks, Commerce identity, and Inventory truth operating on
one storefront surface. The first audience is DinkusKit maintainers and early
adopters evaluating the stack, not shoppers on a production store. The classic
merch-catalog first slice provides collection navigation and a product grid.

## Merchant catalog

The Shop above the separate integration demonstrations is driven by persisted
Commerce Products. Name/SKU and Regular/Sale are operated in native EmDash
Products admin. Missing Regular hides both listing and detail; Sale strikes
Regular. Render truthful Commerce availability without inventing quantity.
The catalog may be empty. No purchase button or checkout is implied. Preserve
the existing neutral visual language, keyboard links, and narrow-screen fit.
Commerce and Inventory launch side by side; separating the current Inventory
demonstration does not defer Inventory from launch.

## Confirmed constraints

- Show each connected product name and truthful current availability prominently
  in a compact summary below the grid, with Commerce Regular/Sale prices when listable, without implying checkout.
  Put SKU, Inventory identity/location/version, sellability/mode, authority
  explanation, and exact package provenance in keyboard-operable native details.
  Unmanaged availability never shows a quantity or Inventory identity.
- Keep unpriced Commerce products off the public home. Preserve EmDash admin editing.
- Distinguish CMS-authored merchandising from transactional Inventory facts.
- Let a human edit the hero and merchandise titles, collection names, descriptions,
  and visual labels in EmDash admin. Preview cards explicitly say they cannot be
  purchased, and contain no purchase links.
- Ship a seeded first-class Home opener block in Pages `layout`, with neutral
  copy and no prices or stock. Each inserted/duplicated card owns independent
  field values; there is no implicit `/section` insertion into the blocks field.
  Keep legacy Portable Text and its `/section` content renderable during
  migration. The site migration explicitly copies old compositions and never
  overwrites an already-populated `layout`.
- Give each published collection and product a browsable page with catalog/collection back links. Unpublished or missing paths return 404. Product pages use current Commerce/Inventory availability for the two exact connected IDs; previews explicitly remain non-purchasable.
- Use neutral tees, hoodies, and hats; no site-specific branding or invented
  price, cart, checkout, shipping, coupons, bundles, or payment affordances.
- Preserve semantic headings, keyboard navigation, visible focus, sufficient
  contrast, and useful status text without relying on color alone.
- Fit narrow mobile and desktop Chromium viewports without horizontal overflow.
- Keep proof controls out of the customer page; automated mutation uses a
  proof-only HTTP endpoint.

## Unresolved visual language

The first slice uses a restrained warm-neutral catalog scaffold, text-only
merchandise visual placeholders, and a responsive three-to-one-column grid.
Photography, final typography, and the selected design system remain unresolved;
a later GrillTrack visual cycle will present five materially distinct candidates
on the verified real page.

## Component contract

- EmDash Merchandise entries render grouped catalog cards; category names link
  to collection pages, and every card links to its product page. The card status reads the connected runtime or
  says preview only; it never stores an editorial stock quantity.
- A shop owner may add a first-class Query Card to Pages `layout` to list up to
  24 current published editorial records from one collection: image, title,
  text, and safe link. Adding a published record updates the list without
  republishing the page. Drafts stay private. This does not replace product or
  collection routes or add filters, pagination, price, stock, or cart.
- Existing Portable Text continues to render through its original renderer when
  no first-class `layout` has been migrated. A page's populated `layout` takes
  precedence; the previous `content` field is retained as a rollback source.
- Dinkus Blocks render CMS composition through their documented classes,
  attributes, and theme tokens.
- Card View availability links target focusable, visibly highlighted summaries.
  Both summaries retain their machine-readable `data-*` proof hooks; native
  details keep the technical facts and provenance available without dominating
  the shopper-facing page. The managed read remains fail-closed.
- Loading and mutation controls are not required in the first server-rendered
  slice. Browser proof reloads after each command.

## Verification

`bin/verify-web full` must build the real Astro project and run desktop and
mobile browser acceptance through the complete managed `8 -> 5 -> 8` stock
sequence and the unmanaged manual-availability sequence. Curated screenshots
and the exact assertion record belong in the current proof packet.
