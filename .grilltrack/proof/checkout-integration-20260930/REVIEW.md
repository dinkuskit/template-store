# Independent exact-source review

Reviewed source: `49cea8c54774fd5064965d51dddce5087a9bf510` in
`codex/template-store-checkout-integration-20260930`, based on
`41a63299d575eeb9784de700c63ca628543b2d60`.
Worktree: `/Users/bobbybones/Developer/dinkus/template-store-checkout-integration-20260930`.

The parent verifier reviewed the native ACP implementation independently against
the actual Commerce and Payments sources, host serialization, SQLite behavior,
full verification output, and desktop/mobile screenshots. This is parent review
evidence, not a ClawSweeper result or merge approval.

## Accepted fixes and evidence

- Exact Commerce pin and native Products entry match the merged source. Catalog
  availability uses the current storage property while preserving the existing
  consumer. Proof storage implements the current CAS and conditional-delete
  interfaces; it remains disposable development storage.
- Trusted site configuration comes only from explicit host input. The parent
  native probe rejects an unconfigured site even when request origin matches;
  a retained capability cannot authenticate against another trusted site.
- Browser prepare retains the bearer in-page before start, survives reload,
  and observes repeated `PAYMENTS_UNAVAILABLE`. Trace and video are disabled.
  Missing/forged capability, caller money/cart injection and cross-origin probes
  fail. Exact capability delta is +1; zero checkout aggregates establish zero
  attempts and embedded orders. The UI remains disabled and forged return
  parameters cannot establish payment.
- Shipping Products shows the disabled stock control and Coming soon message;
  Inventory requests/configuration remain zero. The explicit proof profile
  preserves managed `8 -> 5 -> 8` and unmanaged manual availability regressions.
- Approved design is byte-identical to the base. Guest-cart documentation has
  only the two pin/window wording replacements and preserves frozen attempts,
  lost-response recovery, newer intent, bounded status and paid-only clearing.
- Handoff records actual record fields, route/header identities, principal
  scope, descriptor and host function loss, and the existing reconciliation
  entry point. Provider webhook ACK after durable enqueue is distinguished from
  internal wake ACK after reconciliation. No new order writer is introduced.

Canonical `pnpm verify` passed 31 unit, 9 workflow and 20 browser tests, with
Astro check reporting zero errors/warnings/hints. Log SHA-256:
`e455197a9a7a573c623d5b109babc92283fa40cba68e0394421c43aee6d45e5c`.
The final narrow documentation restoration changed no tested runtime code.
Feature/text audits, ledger validation and diff whitespace checks passed after
restoration. Detailed evidence and limits are in [PROOF.md](PROOF.md).

## Rejected findings

- Conditional delete must return `deleted`: rejected. The installed EmDash
  `ConditionalDeleteResult` requires `applied`; the conformance test covers a
  stale revision and successful deletion.
- Default native 503 means the template should enable checkout: rejected. No
  authenticated Payments bridge is supplied, so denial and disabled UI are the
  expected safe behavior.
- A serialized resolver function supplies Payments transport: rejected. The
  Commerce descriptor drops checkout options and EmDash JSON separately drops
  function properties. Native route registration does not prove a bridge.

## Accepted deferred findings

- Authenticated server transport/host injection and durable wake consumption
  with trusted site/binding/attempt-to-cart routing are missing. Use the typed
  [dependency handoff](DEPENDENCY-HANDOFF.md); no other repository is modified.
- Registry disabled-toggle support, immutable released artifact pairing and
  clean install/upgrade remain blocked. Native aliases do not establish those
  properties; native Blocks/EmDash 1.0 migration remains unqualified.
- Redirect, paid receipt, single paid order, frozen purchase recovery, newer
  intent, lost payment response and restart acceptance remain blocked. Actual
  Stripe is NOT_RUN. Capability reload and direct SQLite connection reopen do
  not qualify a paid purchase or process restart.
- Basic coupons are required for v1 and await the separate owner's public
  interface/evidence. Shipping/contact/tax remain unqualified. Inventory and
  bundles are non-blocking for this bounded unmanaged qualification.
- Material logs include a build chunk-size warning, BlockCard React key errors,
  and an InlinePortableTextEditor invalid-hook/null-useSyncExternalStore SSR
  error during CMS composition. Functional assertions passed; root cause is
  unestablished. Defer a focused host/editor investigation. No clean-console or
  general renderer readiness claim is accepted.

## Human gate

The bounded source qualification is verified with deferred findings. Maintainer
review and explicit merge approval remain required. Release, deployment,
production/provider/account changes are outside this slice. Preserve the
candidate and upstream owners; do not admit another checkout writer implicitly.
