# Guest checkout recovery source slice

This slice composes the browser cart and return/retry/reload flow with the immutable Commerce guest prepare/start/status contract. It proves local source and package behavior; public checkout remains unavailable.

The browser sends only product IDs, bounded integer quantities, and optional scalar coupon intent. Commerce owns prices, totals, payment status, orders and receipts. The original opaque capability and attempt survive reload, ambiguous start, errors and release. Preparation never replaces a saved capability; retry requires authoritative status of that same capability. A released attempt remains retained until Commerce starts its successor. Return query parameters confer no authority. Order confirmation requires a matched paid projection with an attempt, canonical order and receipt.

Requests use exact Registry-derived guest POST paths, same-origin credentials, no-store, an eight-second deadline, a 64 KiB body cap and redirect rejection. The public boundary admits only those three POST paths and shopper success/cancel reads, retaining admin/auth/proof and rate protections. Native/source aliases remain closed. Merchant Stripe callbacks remain protected.

The original PR43 native endpoint substitution is rejected by the existing same-runtime Registry/catalog authority contract; this candidate keeps the Registry runtime identity end-to-end.

## Closed admission

EmDash 1.0.1 runtime-installed settings/route metadata is necessary but insufficient. The supported same-installed catalog/configuration authority contract is unresolved. The shipping caller supplies no catalog authority; all three guest endpoints return unavailable. The local catalog-authority type is a provisional composition input, not a signed install receipt or Core contract. No test flag opens shipping checkout.

## Package and browser evidence

`RUNTIME-RESULT.json` records a passing compiled frontend controller against the immutable Commerce49 default backend, original EmDash workerd context/settings/storage and immutable Payments12 Worker with fully intercepted issuer/Stripe transport. It loses the response after an actual Core start, recovers the same capability current attempt after reload, confirms canonical paid status, clears matching purchased intent and proves a fresh prepare without a second provider creation. Existing positive shipping/pricing, freeze, replay, restart, coupon and settlement-before-ACK cases remain passing. Prior exact-package host and opt-in pair proofs remain cumulative baseline evidence; their source contracts and package inputs are unchanged. Shipped grants remain empty; no real provider request occurs. Local namespace derivation is not a signed Registry installation.

The browser fixture explicitly intercepts HTML before hydration and supplies synthetic admission and wire responses. It proves desktop/mobile controller presentation, retained attempt after reload, pending recovery, authoritative confirmation and closed forged returns. It does not prove actual installed routing, scheduler registration, Stripe activation or a real purchase. Final unchanged-source `pnpm verify` passed:144 unit,9 workflow and19 browser tests,3 skips. Desktop/mobile closed and synthetic admitted return screenshots were visually inspected and hashes are recorded in CHECKS.json. The final canonical run includes typecheck, audits and the production build. CHECKS.json preserves raw-log hashes and non-failing stderr categories.

## Parent adjudication

Required fixes accepted: persist checkout messages through render; prevent saved capability replacement and ambiguous-start retries; retain released attempt identity; match capability/attempt and bound responses; reject redirects; retain recovery after Core errors; make status retry accessible; replace obsolete native source-pilot browser expectations with explicit closed and synthetic controller cases. Each is implemented and covered by focused unit or browser proof.

Rejected toolchain blocker: the earlier missing Rolldown report used Node24 outside the repository's Node22 contract. Existing Node22.23.1 collected the tests successfully without installation changes. The second worker ended after partial fixes with a provider HTTP/2 CANCEL; parent completed and verified the remaining source. Worker completion itself was not accepted as proof.

Remaining product gates: supported installed catalog/config authority, actual Registry delivery/install, real identity and permission provisioning, admitted scheduler and provider activation. Qualified zero-payable Commerce51 archives are retained for the next matched consumer checkpoint; this proof preserves the exact Commerce49 baseline and makes no zero-order execution claim. EmDash1.2 migration is a separate owner slice. Source delivery stops at the maintainer merge gate.

## Accepted review repairs

The native P1 paid-cart lock finding and the parent successor response-loss finding on git:27c3579802bbe9251a87f9677b1b98149b6e63f7 are repaired. The original capability is retained for receipt reload until explicit new purchase. Cleanup markers affect only browser cart cache and never confirm payment. Unknown starts query the current attempt through the same capability. Purchased intent clears only after matched authoritative paid order lines; newer or changed contents survive replay and interrupted browser writes. Returning to the cart refreshes paid status and permits fresh preparation for a new purchase after cleanup.

See NATIVE-PAID-CLEANUP-FINDING.md, SUCCESSOR-RECOVERY-FINDING.md and PRIOR-SOURCE-REPRODUCTION.json for dispositions and reproduced prior behavior. Earlier CI/OpenClaw/native evidence cannot clear the repaired source.

## PR43 admission and recovery repair

The repair preserves server-rendered Registry/catalog admission instead of treating capability preparation as Payments readiness. Retained paid-cart recovery finishes before preparation for a new cart; active attempts remain retained. Coupon controls follow the same admission and attempt lock. Registry-derived endpoint identity and the existing explicit unavailable/native-denial responses are preserved. Browser fixtures remain synthetic and cannot qualify installed checkout. The original PR43 decision history is retained through CLI-reconciled same-repository lineage. Candidate verification and exact-source reviewer results are recorded in the repair PR; earlier checks do not qualify this changed source.

Proactive preparation is skipped when server admission is closed, preserving catalog snapshot loading and failure messages. The separate retained-checkout status recovery remains available. Focused desktop/mobile guest-cart tests (2) and synthetic shipping feasibility tests (8) pass under Node 22.23.2; the final full verification and reviewer gates remain PR-scoped evidence.

Native review identified an in-flight preparation race. The cart lock now includes the pending preparation probe. A gated synthetic response regression waits for the catalog snapshot, proves checkout/coupon/quantity controls stay disabled before the controller timeout, then releases preparation and exercises paid recovery plus a second cart. The regression reproduced enabled checkout before the fix on desktop and mobile; all eight shipping feasibility cases pass after repair. Production admission and offline network denial remain unchanged.

## Bounded return status checks (#20 follow-up, PR46)

The return page now allows at most five Commerce status checks per page load, counting the automatic first check (`MAX_GUEST_CHECKOUT_STATUS_CHECKS`). When the budget is spent the retry button is disabled and the page says status checks are limited and that no purchase was confirmed. A spent budget never infers payment, never changes the retained capability or attempt, and never asks for a retry it will refuse: a failed or pending final check, and a confirmed order whose cart could not be settled, all drop the "check again" wording. Commerce remains the only payment and order authority.

`return status checks stop after the bounded retry budget` drives one automatic and four manual checks against an always-pending synthetic status, asserts exactly five status calls, a disabled button and the limited message, then force-clicks the disabled button and asserts no sixth call. Unit coverage pins `canRetryGuestCheckoutStatus` : 0 and 4 allowed; 5, -1 and 1.5 refused.

CI `Store verification` on git:a28d25b253c42d3c680cd3f092933f9d15883d0f (run 37991493705, Node 22.23.2) ran full `pnpm verify`: astro check, unit and workflow tests, audits, production build, 25 browser tests passed with 3 skips, including the bounded-retry case on `shipping-chromium-desktop` and `shipping-chromium-mobile`, then `verify-site` passed and `verify-web: full passed`. Screenshots stay under ignored `runs/`. The browser harness is synthetic and does not prove installed routing or a real purchase.
