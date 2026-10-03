# TEST checkout host source proof

This bounded source candidate implements a server-owned Payments wake client and
an in-process scheduler adapter. It does not enable checkout on the hosted demo.

## Immutable inputs

- Template base: `bd997144517242e0a70596e15de20bbfc3314df8`.
- Commerce #42 merge: `5710fc185645ed56098aff5727da03483be067ea`.
- Commerce owner archive SHA-256:
  `cc76f8384ba86398fc367c635a263fb7bb01f10a7296bd6485d4e74fde56c200`.
- Payments #11 merge: `3c2e1f1e738426f31597977bf41e6051de305137`.

The normal development verifier prepares the public Commerce source at that
exact commit. It needs no manually extracted owner package. Source aliases are
development integration, not a Registry release or installed-plugin proof.
`pnpm verify:checkout-package <owner-commerce.tgz>` independently checks the
admitted archive digest, extracts it into a fresh proof directory, and runs the
host tests against its compiled checkout export. The archive must be supplied
through the owner's immutable handoff; this command does not fetch an invented
release or publish a package.

## Implemented behavior

The wake client uses the admitted bare HTTPS Payments origin, signed site scope,
binding, server credential resolver and scoped fetch. Redirects are rejected and
responses are not cached. List bodies are capped at 128 KiB and ACK bodies at
16 KiB before JSON parsing, including chunked streams with no Content-Length.
Unsupported bodies fail closed. Oversized streams are cancelled.

Wake snapshots contain exactly `attemptId`, `bindingRef`, `deliveryGeneration`,
`eventId`, and `wokeAt`. Attempt and binding references are opaque nonempty
strings of at most 200 characters. Event IDs match `^evt_[A-Za-z0-9]+$`, delivery
generations are positive safe integers, and wokeAt is finite. A bare origin with
a trailing slash is normalized. ACK captures the validated immutable snapshot
before awaiting credentials and transmits those same five fields.

The scheduler derives the canonical TEST payment host and wake port from one
configuration snapshot. It rejects a mismatched admitted execution binding
before transport, preserves the caller's canonical storage/catalog/clock, and
uses Commerce's reconciliation without a callback override. Unknown outcomes
retain the existing attempt. Canonical reconciliation ACKs only after a terminal
paid order write or confirmed release; a failed order write prevents ACK.

The default Worker exports EmDash maintenance only. Its optional in-process
checkout assembly requires an admitted installed-plugin execution/storage
context. It preserves the configured maintenance cron filter and uses
`ctx.waitUntil`. Descriptor JSON cannot carry callback functions. EmDash does
have plugin cron contexts; this starter has not proved a supported installed
checkout host/storage injection. See [the runtime gate](RUNTIME-ACTIVATION-GATE.md).

## Verification and limits

Verification records are retained under the ignored
`runs/test-checkout-host-runs/20261003/` directory. Accepted October 3 results and raw-log digests are recorded in
[VERIFICATION.json](VERIFICATION.json): 106 unit tests, 9 workflow tests and
17 desktop/mobile browser checks passed, with 3 expected profile skips. Astro
reported zero errors/warnings and one existing hint; Node and explicit
Cloudflare builds passed. All 40 host tests also passed against the fresh
compiled Commerce owner package. Fresh public source preparation needed no
owner archive. Earlier failed and interrupted logs remain preserved and are
excluded from accepted verification. Upstream development cleanup SQLite
errors and React key warnings appeared without failing the required assertions.

The host tests use synthetic HTTP responses and in-memory CAS storage. They
exercise paid-write-before-ACK, failed writes, unknown lookup, foreign binding,
duplicate reconciliation, the inclusive 1800/1860-second provider window, and
preservation of the original payment request/session. Recreating an in-process
driver over the same fixture is not disk, D1, or process-restart durability.

The full source verifier exercises desktop/mobile Chromium, the unmanaged
admin-to-storefront journey, existing native Blocks and development Inventory
regressions. No storefront redesign or Inventory requirement is introduced.
No actual Stripe payment, installed Registry pair, hosted scheduler, deployment,
account/credential mutation, or production charge is claimed.
