# Shopper order history shows recorded shipment details: Registry proof

2026-11-02 UTC, PR #205 head `2ab8449`. Node `24.22.0`, pnpm `11.9.0`, EmDash `1.4.0`.
Commerce is the template's pinned Registry build: `v0.8.0` (`35f80f2`), prepared by
`pnpm prepare:sources` and installed in the visitor's store under its Registry id
`r_gshdrqaldna3r7sn` (GrillTrack `template-one-build-registry-20261031`,
`playground-commerce-in-store-20261031`).

## What ran

`prove.mjs` builds nothing itself; run it after
`node node_modules/astro/bin/astro.mjs build --config astro.playground.config.mjs`:

```sh
node proof/shopper-order-shipment-20261102/prove.mjs
```

It serves the built playground Worker with `wrangler dev` (the existing
`scripts/lib/playground-worker-proof.mjs` helper, local proof vars as in
`scripts/verify-playground-account-http.mjs`), opens a fresh visitor store, and
then, with **no route interception or mocked responses**:

1. Lists orders through Commerce's own `orders` admin route and picks the
   seeded Processing sample order #1004.
2. Signs the order's shopper in with Commerce's real email-code flow
   (`account/sign-in/start`, code from the local proof mailbox,
   `account/sign-in/verify`).
3. Completes the order through Commerce's `orders` route with carrier `USPS`
   and tracking `9400111899223344556677`.
4. Reads `account/orders` with the shopper session: Commerce returns
   `completed: { at, carrier, tracking }`.
5. Opens `/account` in Chromium at desktop (1440x1000) and iPhone 13 sizes
   with that session, and reads the order card.
6. Reopens the order through the `orders` route, reloads both pages, and reads
   the card again.

## Results (`trace.json`)

| Step | Result |
|---|---|
| Complete with carrier and tracking | HTTP 200, `result: "saved"` |
| `account/orders` after complete | `status: "completed"`, `carrier: "USPS"`, `tracking: "9400111899223344556677"` |
| Desktop `/account` | "Completed", "Carrier: USPS", "Tracking number: 9400111899223344556677", no horizontal scroll |
| Phone `/account` | same text, no horizontal scroll |
| Reopen | HTTP 200, `result: "saved"` |
| Desktop and phone `/account` after reopen | "Processing", zero shipment elements |

Screenshots of the order card (the playground tour panel and toolbar were
hidden before each shot so the card is visible; the text checks ran first):

- `desktop-completed.png`, `mobile-completed.png`
- `desktop-reopened.png`, `mobile-reopened.png`

## Limits

This is the playground Worker, which runs the same Commerce Registry bundle the
shipping store mounts through `LOADER`, but in process in the visitor's store.
It is not a paid checkout: the order is the playground's seeded sample paid
order. No carrier, payment provider or email delivery was contacted.
