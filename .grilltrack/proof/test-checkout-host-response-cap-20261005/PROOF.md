# Reviewed payment-response dependency successor

This source-only repair replaces Template27's explicitly recorded Commerce42
input. Prior source `537664f4595712212111a2cb60c274a64ff36081`, old source/package
proof and hashes remain preserved. The prior required P2 is described in
[PRIOR-FINDING.md](PRIOR-FINDING.md).

## Immutable replacement

- Commerce PR44 reviewed pre-release head:
  `444b0505ae061c58e2f738e9f39fb0b366d50e8c`.
- Commerce PR44 base: `7a8d262441d14ea4ec5e824a1baa76b5a6f0049c`.
- Owner npm archive SHA-256:
  `6f63abb17a8cd73bb8edaf4c83ad8ed75b4e35f98f399a4433d675e0a72d8388`.
- Archive size: 126116 bytes. Owner handoff records 261 packaged files matching
  compiled source and 8 compiled public-port tests.
- Payments11 input remains `3c2e1f1e738426f31597977bf41e6051de305137`.

The owner handoff qualifies CI, comprehensive P3 exact-source OpenClaw and
canonical native review/publication at this source. It is neither a merged nor
released artifact. This repository permits exact pre-release source pins;
installed Registry compatibility remains separately unproved. The complete
source delta from42 also includes the merged native coupon administration slice
from43. Public checkout signatures, sandbox guest entry and manifest grants are
unchanged; no coupon Registry compatibility is inferred. Template introduces no
coupon product work here.

## Changed behavior and regressions

Commerce's canonical reader caps actual streamed payment bodies at 131072 bytes
before UTF-8 decoding and JSON parsing across both bindings, session and lookup.
Template's wake list/ACK caps and shared trusted host authority remain unchanged.
The manifest source pin, strict feature audit and compiled-package verifier
commit/digest are updated together.

Against the old42 source, 12 direct assembled-host cases failed and one at-cap
case passed; both added scheduled cap cases failed. The repaired source and
fresh compiled owner package each pass all55 host tests: existing40 plus15 cap
regressions. Oversized valid JSON is rejected with and without Content-Length;
streams are cancelled; unsupported bodies cannot invoke unbounded JSON reading;
an actual131072-byte binding is accepted. An oversized binding prevents the
session call. Scheduled existing-binding/lookup failure preserves the original
attempt/request/session, writes no order and sends no ACK. These fixtures use
synthetic HTTP and in-memory CAS, not provider or persistent-runtime proof.

Fresh exact public source preparation and the explicit Cloudflare build pass.
Required full verification passed:121 unit tests,9 workflow tests and17
desktop/mobile browser checks, with3 expected profile skips. Astro checked112
files with zero errors/warnings and one existing hint; Node build passed.
Accepted commands and raw-log digests are in [VERIFICATION.json](VERIFICATION.json).
Upstream development SQLite cleanup errors and React key warnings appeared
without failing required assertions.
The existing [installed runtime gate](../test-checkout-host-20261001/RUNTIME-ACTIVATION-GATE.md)
remains applicable. No checkout enablement, token/account change, merge, package
release, Registry installation, hosted scheduler or real Stripe TEST purchase
is claimed by this source successor.
