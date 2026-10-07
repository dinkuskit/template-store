# Matched TEST checkout proof

Decision `paired-checkout-010`, dependent on the preserved host decision009.
Commerce reviewed70419ae55c4f73354e3f0eda08b09bbc85368000 (mergead84fe07c6dda1c493cc68a72c4f49cb6e179653) and Payments reviewed37842220fddb10dc5294af084110cd33804715be (merge1d7b5521f9986df7b7f92866b43cf7814826d607) remain distinct immutable identities. No release or installed Registry pair is claimed.

## Behavior and fidelity

One explicit trusted TEST snapshot supplies the pricing/v1 adapter, Commerce pricing context and resolved payment port. Canonical public installed handlers own origin/capability/storage admission and bind coupon storage from the original context. No host-created order, price, coupon or inventory writer is added. Default Worker/public routes and guest-cart activation remain closed.

[COMPILED-PAIR.json](COMPILED-PAIR.json) records actual immutable compiled package execution: Template's locally compiled adapter imports external compiled Commerce; the exact Payments Worker executes its HTTP/JWT/SQLite logic and official Stripe SDK in workerd. No Payments source import or rebuild is used. Archives extract separately with bounded regular-file admission. Commerce archiveSHA38c1c6b59ad37db506986dc9de72fa53f601f7c66d5df53a1c39e9ca3c351730; Payments archiveSHAbb91f476f9e8c1a67ce4aa84cd36722e1c390a4d70b21681b3cf1d7e7feb53e0; Payments WorkerSHA77c6fe70120c962ee482760a2ad308e3f57faaf367e5bba86d74cd13b1eee548.

Three neutral scenarios prove flat199 with non-divisible discount101, free150, and shipping-only50. Both owner stores restart; Payments' original binding survives, replay retains frozen shipping, forged return remains pending, wrong checkout scope is rejected before provider work, readiness regression preserves original recipient recovery, signed HTTP webhook delivers a wake, and canonical reconciliation writes one durable order and consumes one coupon before ACK. Replayed status/order IDs and empty acknowledged wake lists remain stable.

The Commerce PluginContext and owner storage are explicitly uninstalled fixtures. Synthetic keys/JWTs exist only in memory and are never in proof output. All provider/JWKS requests are intercepted; actual provider calls and credential-store reads are zero. Miniflare's bodyless connect HTTP yields400 unexpected_input; synthetic fixture setup uses the actual Payments owner onboarding RPC, not a replacement service or SQL. This does not qualify real HTTP onboarding or any merchant account.

## Verification

[VERIFICATION.json](VERIFICATION.json) records independent parent runs and raw-log digests: pnpm verify PASS (125unit,9workflow,17desktop/mobile browser passes and3expected skips); exact compiled Commerce host/wake fixtures PASS55; pnpm verify:paired-checkout PASS3; typecheck0errors; feature/text/diff audits PASS. No browser UI design is changed. Desktop/mobile screenshots were captured and directly inspected, retaining readable intent and unavailable checkout after a forged success query; [VISUAL-INSPECTION.json](VISUAL-INSPECTION.json) records synthetic provenance/hashes and ignored local retention. No proof media is committed here.

The source-pilot browser logs also contain React list-key warnings and EmDash local revision-cleanup SQLite errors while the assertions pass. Those logs remain authoritative; unattended EmDash cleanup is not qualified by this run.

## Review disposition and remaining owner boundary

Parent rejected the worker's missing-public-export claim: the checkout entry re-exports installed handlers through kernel/index.js. Parent repaired the label-only schema wrapper and replaced hash-only Payments admission with actual compiled Worker behavior proof. Native worker cleanup completed before these repairs; no provider/model fallback was dispatched.

Existing EmDash owner settings/storage, scoped HTTP and cron primitives can support module-local Commerce services. The missing default Registry service assembly belongs to Commerce; generic upstream callable injection is not established as necessary. Current reviewed Commerce backend remains unconfigured. A later qualified owner candidate needs explicit repin and fresh proof; a moving checkout is not consumed. Genuine installed context, configured guest/callback paths, admitted egress, account-token provisioning/renewal and one registered scheduler remain separate receipts. Managed Inventory reserve/release transport remains unavailable; no local ledger/fallback is added. Zero-payable orders remain a separate Commerce slice.

This packet records local implementation/verification and parent source-intent review. Current-head CI, comprehensive OpenClaw and native ClawSweeper evidence are separately required before the maintainer merge gate. No merge, deployment, provider account/payment, grant, credential resolution or Registry publication is performed.
