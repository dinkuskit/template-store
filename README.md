# DinkusKit Store Starter

The public integration and dogfood storefront for EmDash, DinkusKit Blocks,
Commerce, and Inventory.

## Current proof

The first vertical is deliberately smaller than checkout. One neutral product
page proves:

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
backorder, and back to In stock, with no quantity. Price, cart, checkout,
payments, shipping, deployment, persisted Manage Stock toggle, and production
persistence are not claimed yet.

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
