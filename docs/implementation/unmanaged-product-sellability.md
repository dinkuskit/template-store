# Unmanaged product sellability implementation plan

Status: template-store catch-up to Commerce #16 implemented locally
Baseline: `35ac1f272476e3094cecaa30124a5699c53d5a8c`
Commerce source: `b9e432b1869bae09e394f5d631aa97b6949bf2fd`

## Responsibility boundary

The `unmanaged-product-sellability` feature owns only the storefront composition
of Commerce's unmanaged contract:

- create or replay one unmanaged Commerce catalog item;
- resolve storefront availability through `resolveStorefrontAvailability`;
- persist explicit manual availability through
  `setCatalogItemManualAvailability`;
- render status and sellability with no quantity;
- expose availability changes only through a proof-mode HTTP endpoint that
  accepts the same `{ catalogItemId, status }` body as Commerce's authenticated
  `catalog-items/set-manual-availability` action.

It does not own managed Inventory quantity, visual EmDash Commerce UI, the
persisted Manage Stock toggle, price, cart, checkout, payments, shipping, or
package publication. A human still operates merchandising from the EmDash Pages
editor without a code change. Manual availability stays Commerce-owned; the
proof route is the local playground stand-in until Commerce ships admin UI.

## Exact upstream inputs

| Package | Exact source | Consumer status |
| --- | --- | --- |
| `@dinkuskit/blocks` | `82a31183cc06ae0fc5b4829f5a8875753ecde10a` | exact merged source pin |
| `@dinkuskit/commerce` | prepared source checkout at `b9e432b1869bae09e394f5d631aa97b6949bf2fd` | exact Commerce #18 source pin |
| `@dinkuskit/inventory` | `d735b180b3f4ed911667586f5131ff1727e46546` | unused by this feature |
| `emdash` | `0.40.1` | exact released CMS baseline |

## Public feature contract

```ts
export type UnmanagedProductSellability = Readonly<{
  product: Readonly<{
    itemId: string;
    name: string;
    sku: string;
    state: "draft";
    stockMode: "unmanaged";
  }>;
  storefront: StorefrontAvailabilityResult;
  provenance: Readonly<{
    blocks: string;
    commerce: string;
    inventory: string;
  }>;
}>;
```

Missing manual records mean `in-stock`. Explicit states are `in-stock`,
`out-of-stock`, and `available-on-backorder`. Quantity is a fail-closed defect
if it ever appears on this path.

## Renderer and proof

The page keeps the managed Inventory panel and adds a co-located unmanaged
panel. Desktop Chromium and a mobile viewport must both show the unmanaged SKU,
manual status, sellability, and `never` for quantity. Browser proof captures
admin Pages `home` before and after, then drives the proof-only availability
endpoint through `in-stock → out-of-stock → available-on-backorder → in-stock`.
