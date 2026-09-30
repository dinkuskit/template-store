# Independent guest cart presentation proof

Status: bounded cart presentation verified. Exact source review identity is
recorded after the source commit. Repository `dinkuskit/template-store`, branch
`codex/template-store-guest-cart-20260930`, base frozen profile PR21 head
`3f3aaebc81f33be32d4d2f98b7321c4cd154ba01`. This is EmDash 0.41.0 native
source-pilot evidence; checkout and released registry pairing remain pending.
Commerce source stays `81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06`.

## Verification

Native ACP full `pnpm verify` exited0: 24 unit tests, 6 workflow tests and
18 browser cases (16 existing plus2 shipping cart). The source owner separately
ran `pnpm verify:quick`, exit0, and inspected source, desktop/mobile pictures
and the assertion receipts. The managed 8-to-5-to-8 sequence, unmanaged manual
availability cycle, CMS layout/Portable Text migration/history and catalog
price regressions still pass. Earlier admin React key and build-size warnings
remain; they are not claimed repaired.

Both new browser cases use separate anonymous shopper contexts on the default
shipping profile, the exact disposable shipping database, no Edit toolbar,
zero Inventory/proof requests and no stock quantity. Tests cover add, quantity
edit and keyboard Tab, reload, remove/empty, malformed cache, current out-of-stock
and unpriced reads, pending/error/retry, malformed snapshot, bounded timeout,
failed add/quantity persistence, inaccessible storage and forged success URL.
The forged URL keeps intent and never confirms purchase. Cart rows visibly
use the neutral card controls; assertions observe24px padding and16px input
text. Desktop/mobile fit and visible focus were inspected.

Reproducible evidence: `tests/e2e/guest-cart.spec.ts`,
`tests/unit/guest-cart.test.ts`, `tests/unit/guest-cart-snapshot-route.test.ts`.
Ignored run evidence: `runs/guest-cart/final-verify.log`,
`runs/guest-cart/parent-quick-verify.log`,
`runs/guest-cart/browser/shipping-chromium-desktop/`, and the matching mobile
directory. Superseded initial screenshots remain separately retained. No
screenshot or database is committed or published as a release asset.

## Accepted and rejected review findings

- Accepted and repaired: injected DOM missed scoped styles; the initial
  shopper shared an admin session; brittle Save/held-snapshot waits timed out;
  failed add persistence claimed success; shopper copy exposed implementation
  details; snapshot casts could fail outside recoverable handling. Corrected
  browser proof checks the behavior and preserves all baseline cases.
- Accepted and repaired: public projection strips domain quantity/internal
  metadata and unpriced draft name/SKU; response shapes and raw cache size are
  validated, requests are no-store, single-flight and time bounded.
- Accepted implementation choice: the explicitly declared public `ui.ts`
  entry exports Astro components while `index.ts` stays browser-safe. Feature
  ownership is preserved and declared in FEATURE_MAP; consumers use public
  entries, never Dinkus package internals or a demonstration runtime.
- Rejected as a remaining failure: ordinary keyboard quantity editing losing
  its logical Tab destination. The corrected stable controls pass the real
  quantity-to-Remove Tab assertion on desktop/mobile; remove reaches the empty
  state. This is bounded interaction proof, not a claim about every possible
  assistive technology.

## Scope and delivery gates

The browser cache is untrusted identity/quantity intent, with bounded local
presentation limits. Commerce supplies current price and sellability. The
template creates no pricing, stock, order, payment or shipping authority.
Checkout stays disabled with plain shopper copy. Guest capability, frozen
attempts, hosted handoff, durable paid-order return/receipt, purchased-only cart
clearing and actual artifact/host integration depend on Commerce issue32.
A supported immutable public mount/artifact handoff has not been supplied.
These are deferred, not synthetic passing results. Issue20 remains open.

All code/test implementation and repairs used native Cursor ACP with green
exact-workspace readiness and approve-all read/write/exec. Initial job
`eb2e7bc0-6b39-4c05-809f-dbfe4cb978e6` was cancelled after the initial required
findings, with terminal cleanup ready. Sequential repair
`a4ad8a59-e4f8-4d33-88ff-f1ea52f72e18` completed normally with cleanup ready
before any replacement. Local worker termination is observed; backend session
discard is unsupported.

Independent frozen-head review/native ClawSweeper clearance remains pending.
Registry/Blocks/EmDash compatibility, release, hosting/DNS/secrets, real Stripe
proof and merges require their existing owner/human gates. No release,
deployment, live payment, credentials or merge occurred.
