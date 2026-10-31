# Synthetic Demo Seeding and Reset Plan

## Scope and Principles

This document defines the seeding and reset procedure for the hosted DinkusKit Template Store public demonstration profile.

### Safety Rules

1. **Strictly Isolated SKUs**: Seeding and reset operations operate strictly on explicit namespaced SKUs (`DEMO-HOSTED-*`). Non-demo data is never touched or scanned for deletion.
2. **No Raw Database Uploads**: Operators must never upload raw local SQLite databases (`content.db`) to remote D1. Local databases contain development artifacts, temporary credentials, and local path references.
3. **No Broad Deletions**: Destructive operations like table drops, table truncations, or unbounded `DELETE` queries are prohibited. Resetting consists of idempotent state updates to baseline catalog parameters.
4. **No Public Reset Endpoints**: The public boundary gate explicitly denies administrative, setup, schema, auth, and proof mutation endpoints. All seeding and reset operations are executed out-of-band by authorized operators via protected CLI tooling.

---

## Synthetic Demo Catalog Items

| Item Name | SKU | Baseline Price | Sale Price | Initial Availability |
| --- | --- | --- | --- | --- |
| Dinkus Demo Heavyweight T-Shirt | `DEMO-HOSTED-SHIRT` | $32.00 USD | None | In stock |
| Dinkus Demo Structured Cap | `DEMO-HOSTED-CAP` | $28.00 USD | $24.00 USD | In stock |
| Dinkus Demo Ceramic Mug | `DEMO-HOSTED-MUG` | $18.00 USD | None | In stock |
| Dinkus Demo Everyday Hoodie, Size Small | `DEMO-HOSTED-HOODIE-S` | $56.00 USD | None | In stock |
| Dinkus Demo Everyday Hoodie, Size Medium | `DEMO-HOSTED-HOODIE-M` | $56.00 USD | None | In stock |
| Dinkus Demo Canvas Tote | `DEMO-HOSTED-TOTE` | $26.00 USD | None | In stock |
| Dinkus Demo Woven Throw | `DEMO-HOSTED-THROW` | $48.00 USD | $42.00 USD | In stock |
| Dinkus Demo Catchall Tray | `DEMO-HOSTED-TRAY` | $22.00 USD | None | In stock |
| Dinkus Demo Ribbed Socks | `DEMO-HOSTED-SOCKS` | $14.00 USD | None | Out of stock |
| Dinkus Demo Steel Bottle | `DEMO-HOSTED-BOTTLE` | $30.00 USD | None | In stock |

The Everyday Hoodie is one product with a Size option (Small, Medium); each size is its own `DEMO-HOSTED-*` SKU and is reset to the same baseline.

### Demo Product Placeholder Assets

Local SVG placeholders for the nine demo products live under `public/images/products/{tote,tray,mug,hoodie,shirt,socks,bottle,cap,throw}.svg` and are served at `/images/products/<kind>.svg`. Keeping these static assets under `/images/products/` rather than `/products/` avoids colliding with the `/products/[id]` route and the Cloudflare Worker's slug-only `/products/[a-zA-Z0-9_-]+` boundary check (which previously returned a JSON 404 before static asset lookup), while keeping Commerce demo placeholders distinct from the seeded editorial garment illustrations under `/merch/*.svg`.

---

## Seeding Procedure

The demo runs Commerce's Registry build (template-one-build-registry-20261031),
so the demo catalog is written the way the owner's own tools write products:
through the installed Commerce's private routes (`catalog` and
`catalog-items/set-on-sale`), as an Administrator. The store does this itself
(`src/features/playground/demo-registry-seed.ts`), create-only-if-missing and
keyed by SKU, on the first request EmDash hands its full runtime to, which is a
signed-in person's. A fresh deploy therefore seeds when the owner first opens
the admin behind Access. Nothing opens Commerce's storage; Commerce holds the
link from each demo page (`demo-<kind>`) to its product and builds its own
unique indexes on a fresh store's first requests (a seed attempt before that is
refused and retried on the next signed-in request).

The earlier D1 seeder (`scripts/seed-synthetic-demo.ts`, its scheduled-index
harness and seed bundle) wrote the retired native copy's `dinkus-commerce`
camelCase collections directly; it was removed with that copy. Nothing in the
repository writes Commerce's storage from outside Commerce any more.

Local check, on a disposable store:

```bash
pnpm dev:fresh
```

Open `/_emdash/admin` once; the shop then lists the nine demo products (ten
SKUs, both hoodie sizes) at the baseline prices and availability, served from
Commerce's public catalog under its Registry runtime id.

---

## Reset Procedure

If the demo storefront requires resetting to its baseline state:

1. There is no baseline reset tool for the Registry build yet: the seed creates
   missing products and never changes one that exists. Resetting an edited demo
   product means editing it back in its page's Dinkus Commerce panel, or with
   the `dinkus-commerce` CLI against the demo's `catalog` route, until a reset
   that speaks the installed Commerce's routes is written (follow-up).
2. Any guest cart sessions in client storage expire or can be cleared by end
   users; no server-side order or checkout records are created because checkout
   is disabled on the public demo.
