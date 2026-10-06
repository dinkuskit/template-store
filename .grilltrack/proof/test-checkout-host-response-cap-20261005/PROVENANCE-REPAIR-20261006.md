# Current Commerce provenance repair

The [native review of the prior head](https://github.com/dinkuskit/template-store/pull/27#issuecomment-6026766297)
identified a required P2: the manifest selected Commerce
`444b0505ae061c58e2f738e9f39fb0b366d50e8c`, while current runtime provenance,
documentation and test assertions still named the previous source.

The managed and unmanaged proof runtimes, their unit expectations, the shipping
browser assertion, and current pairing/cart documentation now report the exact
manifest identity. Historical decision and verification records are preserved.
The dependency pin and checkout behavior are unchanged by this repair.

Fresh owner verification addresses the review workspace's absent dependency:

- Prepared Commerce source HEAD is exactly `444b0505ae061c58e2f738e9f39fb0b366d50e8c`, with a clean tracked tree.
- The admitted 126116-byte owner archive has SHA-256 `6f63abb17a8cd73bb8edaf4c83ad8ed75b4e35f98f399a4433d675e0a72d8388`.
- `pnpm verify:checkout-package <admitted-owner-archive>` passes all 55 checkout-host tests against a fresh extraction of its compiled public checkout export.
- Package recheck log SHA-256: `84cb9b8989e2972cdc468d63212d72f35475a559f02c101855035d6a9ab2a869`.
- The current full verifier has passed 121 unit tests and 9 workflow tests; build and desktop/mobile browser verification are being completed independently with current CI before the maintainer gate.

These are synthetic HTTP/in-memory CAS contracts for the admitted pre-release
source. They do not establish Registry installation, hosted scheduler activation,
real Stripe TEST payment, or a persistent paid order. Product merge and deployment
remain separate owner gates. The prior native `needs-human` verdict is preserved;
the corrected source requires fresh review.
