# DinkusKit Store Starter design contract

Updated: 2026-09-25
Canonical path: `design.md`

## Product intent

Provide a neutral, legible proving ground where a store builder can see EmDash
composition, Dinkus Blocks, Commerce identity, and Inventory truth operating on
one storefront surface. The first audience is DinkusKit maintainers and early
adopters evaluating the stack, not shoppers on a production store.

## Confirmed constraints

- Show the managed product name, visible SKU, Inventory location, available
  quantity, and exact package provenance without implying price or checkout
  exists.
- Show the unmanaged product name, visible SKU, and Commerce manual
  availability status without a quantity, Inventory identity, or checkout.
- Distinguish CMS-authored merchandising from transactional Inventory facts.
- Preserve semantic headings, keyboard navigation, visible focus, sufficient
  contrast, and useful status text without relying on color alone.
- Fit narrow mobile and desktop Chromium viewports without horizontal overflow.
- Keep proof controls out of the customer page; automated mutation uses a
  proof-only HTTP endpoint.

## Unresolved visual language

Color, typography, spacing scale, shape, elevation, imagery, iconography,
motion, and final product-page composition remain unresolved. The first
implementation is a neutral functional scaffold and must not be treated as the
template's selected design system. A later GrillTrack visual cycle will present
exactly five materially distinct candidates on the verified real page.

## Component contract

- Dinkus Blocks render CMS composition through their documented classes,
  attributes, and theme tokens.
- The managed-product panel exposes a labelled stock status, machine-readable
  `data-*` hooks for proof, upstream provenance, and a fail-closed error state.
- The unmanaged-product panel exposes a labelled manual availability status,
  sellability, machine-readable `data-*` hooks for proof, and never a quantity.
- Loading and mutation controls are not required in the first server-rendered
  slice. Browser proof reloads after each command.

## Verification

`bin/verify-web full` must build the real Astro project and run desktop and
mobile browser acceptance through the complete managed `8 -> 5 -> 8` stock
sequence and the unmanaged manual-availability sequence. Curated screenshots
and the exact assertion record belong in the current proof packet.
