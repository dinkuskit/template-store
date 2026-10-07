# Guest checkout recovery source slice

This slice composes the browser cart and return/retry/reload flow with the immutable Commerce guest prepare/start/status contract. It proves local source and package behavior; public checkout remains unavailable.

The browser sends only product IDs, bounded integer quantities, and optional scalar coupon intent. Commerce owns prices, totals, payment status, orders and receipts. The original opaque capability and attempt survive reload, ambiguous start, errors and release. Preparation never replaces a saved capability; retry requires authoritative status of that same capability. A released attempt remains retained until Commerce starts its successor. Return query parameters confer no authority. Order confirmation requires a matched paid projection with an attempt, canonical order and receipt.

Requests use exact Registry-derived guest POST paths, same-origin credentials, no-store, an eight-second deadline, a 64 KiB body cap and redirect rejection. The public boundary admits only those three POST paths and shopper success/cancel reads, retaining admin/auth/proof and rate protections. Native/source aliases remain closed. Merchant Stripe callbacks remain protected.

## Closed admission

EmDash 1.0.1 runtime-installed settings/route metadata is necessary but insufficient. The supported same-installed catalog/configuration authority contract is unresolved. The shipping caller supplies no catalog authority; all three guest endpoints return unavailable. The local catalog-authority type is a provisional composition input, not a signed install receipt or Core contract. No test flag opens shipping checkout.

## Package and browser evidence

`RUNTIME-RESULT.json` records a passing compiled frontend controller against the immutable Commerce49 default backend, original EmDash workerd context/settings/storage and immutable Payments12 Worker with fully intercepted issuer/Stripe transport. It exercises capability retention, actual pending start and canonical paid status. Existing positive shipping/pricing, freeze, replay, restart, coupon and settlement-before-ACK cases remain passing. Prior exact-package host and opt-in pair proofs remain cumulative baseline evidence; their source contracts and package inputs are unchanged. Shipped grants remain empty; no real provider request occurs. Local namespace derivation is not a signed Registry installation.

The browser fixture explicitly intercepts HTML before hydration and supplies synthetic admission and wire responses. It proves desktop/mobile controller presentation, retained attempt after reload, pending recovery, authoritative confirmation and closed forged returns. It does not prove actual installed routing, scheduler registration, Stripe activation or a real purchase. Full `pnpm verify` passed:139 unit,9 workflow and19 browser tests,3 skips. Desktop/mobile closed and synthetic admitted return screenshots were visually inspected and hashes are recorded in CHECKS.json. Final quick checks after the last UI boundary fixes also passed. The final production build also passed after the last source changes. CHECKS.json preserves raw-log hashes and non-failing stderr categories.

## Parent adjudication

Required fixes accepted: persist checkout messages through render; prevent saved capability replacement and ambiguous-start retries; retain released attempt identity; match capability/attempt and bound responses; reject redirects; retain recovery after Core errors; make status retry accessible; replace obsolete native source-pilot browser expectations with explicit closed and synthetic controller cases. Each is implemented and covered by focused unit or browser proof.

Rejected toolchain blocker: the earlier missing Rolldown report used Node24 outside the repository's Node22 contract. Existing Node22.23.1 collected the tests successfully without installation changes. The second worker ended after partial fixes with a provider HTTP/2 CANCEL; parent completed and verified the remaining source. Worker completion itself was not accepted as proof.

Remaining product gates: supported installed catalog/config authority, actual Registry delivery/install, real identity and permission provisioning, admitted scheduler and provider activation. Qualified zero-payable Commerce51 archives are retained for the next matched consumer checkpoint; this proof preserves the exact Commerce49 baseline and makes no zero-order execution claim. EmDash1.2 migration is a following focused slice. Source delivery stops at the maintainer merge gate.
