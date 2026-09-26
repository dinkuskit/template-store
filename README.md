# DinkusKit Store Starter

The public integration and dogfood storefront for EmDash, DinkusKit Blocks,
Commerce, and Inventory.

## Current proof

The classic catalog first slice adds EmDash-managed merchandise entries and
collection navigation for tees, hoodies, and hats, with collection and individual product pages. The hero and product grid are
neutral; preview cards say they are not purchasable. Two connected styles carry
real availability in compact summaries below the grid; card availability links jump to those
summaries, while detail links open product pages, and technical facts remain available in expandable details. Other
styles are editorial previews. The underlying
availability vertical remains deliberately smaller than checkout:

```text
EmDash composition -> Dinkus Blocks
                    -> Commerce catalog + managed SKU
                    -> Inventory registration + stock truth
                    -> storefront availability
                    -> Commerce unmanaged catalog + manual availability
                    -> storefront sellability without quantity
```

The browser verifier observes an opening managed quantity of eight, applies a
real Inventory adjustment to five, then restores eight. It also observes the
unmanaged product default to In stock, then Out of stock, Available on
backorder, and back to In stock, with no quantity. Edit the hero in EmDash Pages → home, and edit names, collection names,
descriptions, and illustration styles in Merchandise. Connected status is reserved
for the exact seeded Everyday Tee and Canvas Cap entry IDs; all other entries
are non-purchasable previews.
The two connected Commerce identities, Regular/Sale prices, and availability are
owned by Commerce/Inventory, not by page content. Connected catalog cards and
product pages show Commerce prices only when Regular exists. The unpriced Commerce
draft stays off the public home; editorial preview entries remain explicitly
non-purchasable and have no invented prices. Visual Regular/Sale admin boxes,
cart, checkout, payments, shipping, deployment, persisted Manage Stock toggle,
and production persistence are not claimed yet.

## Development

Requires Node `22.23.2` or another compatible Node 22 release and pnpm 11.

```bash
pnpm install
pnpm verify
pnpm dev
```

The Dinkus packages are pre-release exact Git pins. `pnpm dev`, `pnpm build`,
and the verifiers prepare Commerce's exact source in an ignored checkout, then
resolve Commerce and Inventory through their package-root source entries because
neither has an installable release yet. See
[`docs/implementation/managed-product-availability.md`](docs/implementation/managed-product-availability.md)
and
[`docs/implementation/unmanaged-product-sellability.md`](docs/implementation/unmanaged-product-sellability.md).

The intended eventual starter command remains:

```bash
npm create astro -- --template dinkuskit/template-store
```

Part of [DinkusKit](https://github.com/dinkuskit). Under construction,
dogfooding in the open. MIT.
