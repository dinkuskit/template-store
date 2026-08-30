# Managed product availability implementation plan

Status: implemented and locally verified; immutable-source review pending
Baseline: `93c6991af4b433877d5bf252e059822e45562662`
GrillTrack decisions: `template-store-role-001`,
`managed-product-vertical-002`, `xapi568-proof-003`

## Responsibility boundary

The `managed-product-availability` feature owns only the storefront composition
of existing package contracts:

- retrieve the neutral EmDash product-page composition;
- create or replay one Commerce catalog item;
- adapt Commerce's provider port to Inventory's managed-SKU command;
- establish one disposable proof location and opening balance;
- read Inventory availability for the Commerce-linked Inventory SKU;
- render provenance and availability on the storefront;
- expose stock adjustment only through a proof-mode, system-principal endpoint.

It does not own price, sellability, cart, checkout, payments, shipping,
reservations, production persistence, package release policy, or ordinary CMS
authoring.

## Exact upstream inputs

| Package | Exact source | Consumer status |
| --- | --- | --- |
| `@dinkuskit/blocks` | `82a31183cc06ae0fc5b4829f5a8875753ecde10a` | exact merged source pin |
| `@dinkuskit/commerce` | prepared source checkout at `9fd24c6a13a4a4d332109e2d4541b05ec5f83786` | exact merged pilot source pin; ignored checkout bypasses the empty pre-release `dist/` package |
| `@dinkuskit/inventory` | `d735b180b3f4ed911667586f5131ff1727e46546` | provisional exact PR #14 source pin for ordinary adjustment |
| `emdash` | `0.35.0` | exact released CMS baseline |

Commerce and Inventory are private `0.0.0` source packages without complete
installable release entries. Commerce's manifest packages only `dist/`, which
does not exist at the pinned head, so `scripts/prepare-source-deps.mjs` creates
an ignored, detached checkout at the exact declared commit. TypeScript and Vite
map both package roots to each dependency's declared `src/index.ts` composition
root. The mapping and source preparer must disappear when installable releases
are proven; the starter must never reach feature internals.

## Public feature contract

```ts
export type ManagedProductAvailability = Readonly<{
  product: Readonly<{
    itemId: string;
    name: string;
    sku: string;
    state: "draft";
  }>;
  inventory: Readonly<{
    inventorySkuId: string;
    poolId: string;
    locationId: string;
    onHand: string;
    reserved: string;
    available: string;
    unit: string;
    version: string;
  }>;
  provenance: Readonly<{
    blocks: string;
    commerce: string;
    inventory: string;
  }>;
}>;

export type StockProofAdjustment = Readonly<{
  commandId: string;
  delta: string;
  reason: "proof-change" | "proof-restore";
}>;

export interface ManagedProductAvailabilityRuntime {
  read(): Promise<ManagedProductAvailability>;
  adjust(input: StockProofAdjustment): Promise<ManagedProductAvailability>;
}
```

Invalid, conflicting, stale-version, unregistered-SKU, missing-location, and
upstream rejection states fail closed with a typed feature error. No UI path
creates a Commerce-local quantity or falls back around Inventory.

## State and invariants

```text
neutral EmDash composition
  -> Commerce catalog create/replay (managed, setup-required)
  -> one atomic Commerce registration claim
  -> Inventory sku.register (registered or exact existing identity)
  -> Commerce active Inventory SKU link
  -> Inventory location + opening balance
  -> Inventory authoritative availability read
  -> storefront render
```

- Bootstrap is idempotent. Repeating it returns the same catalog item, managed
  SKU, location, and opening-balance result.
- Exactly one Inventory SKU identity backs the Commerce product.
- Every stock mutation is an Inventory command with a stable command ID,
  expected version, immutable receipt, and system principal.
- The proof sequence is `8 -> 5 -> 8`; the final restored read must carry a
  later Inventory version and the original available quantity.
- Proof mutation routes return `404` unless `DINKUS_PROOF_MODE=1`.
- The adapter serializes transactions and rejects version drift. It makes no
  production durability or concurrency claim.

## Renderer and proof

The page uses real Dinkus Blocks for CMS-authored composition and a co-located
managed-product availability panel for transactional facts. Desktop Chromium
and a mobile viewport must both show package provenance, SKU identity, location,
and current available quantity. The browser suite drives the proof-only
adjustment endpoint, reloads the real page after each mutation, and retains
initial, changed, and restored screenshots.

The neutral scaffold is not a selected visual direction. `design.md` records
only confirmed functional and accessibility constraints.

The Astro live-content registration is owned by `src/live.config.ts`. Browser
startup reaches EmDash's development setup endpoint before the first storefront
query so the seed and its published `home` entry exist before Astro's live
loader can observe them.
