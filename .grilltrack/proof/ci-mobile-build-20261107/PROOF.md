# Mobile-only production build qualification

Base: `b9eecb7aea06b27b88a984d6731e97fa2534a2a7`. Prepared candidate; no gain claimed.

## Acceptance declared before candidate measurement

Compare the exact `bin/verify-web browser` command with `VERIFY_E2E_PROJECTS=chromium-mobile,shipping-chromium-mobile`, Node24.22.0/pnpm11.9.0 and the same locked dependencies. Start two interleaved pairs (baseline,candidate,candidate,baseline) on the same isolated checkout. Remove only this task's generated dist before every sample; canonical startup recreates both profile stores. Record shared prepared source/cache inputs and each capture's elapsed/CPU/RSS, production-build count, selected case identities and outcomes, including startup/warming work. Do not delete shared caches.

Require every sample to retain70case identities,65passes/5expectedskips, one worker and zero retries. Candidate samples must keep dist absent through normal mobile execution; full/desktop/unset/unknown/special-adapter/Cloudflare paths must retain production build. A passing candidate requires at least5s median paired elapsed improvement with no systematic CPU increase above5%; mixed signs or warming shifts make the initial result inconclusive and require a bounded third pair before any gain claim. Report this as phone-job work, not workflow critical-path or billing improvement.

Focused command-contract tests, capture-helper failing-command proof and the full canonical verifier remain required. No source/Commerce preparation, product/fixture semantics, assertions or pins change. Measurement and validation results pending.
