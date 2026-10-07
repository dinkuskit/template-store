# Commerce49 default-runtime adoption

The Template candidate pins review-qualified Commerce49 source
`45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef` and immutable Payments12 source
`37842220fddb10dc5294af084110cd33804715be`. Full archive/backend/manifest digests
and exact runtime results appear in `RUNTIME-RESULT.json`.

`pnpm verify:registry-checkout` PASS: immutable default Commerce backend through
EmDash 1.0.1 WorkerdSandboxRunner's original context, owner-versioned/encrypted
settings and SDK PluginStorageRepository CAS; immutable Payments HTTP/JWT/SQLite
Worker and original Stripe SDK with fully intercepted issuer/provider transport.
No backend is rebuilt. Local namespace derivation/normalization repeats the
pinned host algorithm; it does not attest signed Registry delivery/install.

Three positive pricing cases (199, 150, 50 USD cents) pass both owner-store
restart, frozen shipping/total replay after settings change, forged browser
return remaining pending, webhook wake, canonical settlement before ACK,
repeat empty wakes, one provider create, one order and one coupon consumption.
The 101-cent discount preserves non-divisible whole-line allocations.
Unconfigured/disabled profiles have zero credential/transport/attempt writes.
Configured empty grants retain one unconfirmed paying attempt with no provider
request/order/ACK. Wrong origin, copied configuration and invalid token claims
reject before transport.

Shipped grants remain empty and public checkout stays disabled. Synthetic
process-only credentials and cloned test permissions establish neither real
identity provisioning/renewal nor installed permissions. Local bodyless connect
HTTP returns 400; setup uses original Payments owner onboarding RPC. No actual
Registry publication/delivery/install, deployed callbacks, scheduler
registration or real Stripe TEST purchase is claimed. Zero-payable canonical
orders and managed Inventory transport remain later owner slices.

This is local runtime acceptance proof. CI and comprehensive exact-PR source
reviews are recorded separately after source commit; maintainer merge authority
remains separate.

Full `pnpm verify` PASS: typecheck/build/audits, 125 unit tests, 9 workflow
tests, 17 desktop/mobile browser passes and 3 skips. Immutable Commerce consumer
tests PASS 55; historical opt-in paired verifier PASS. `CHECKS.json` records
command-log digests and non-failing stderr disposition.
