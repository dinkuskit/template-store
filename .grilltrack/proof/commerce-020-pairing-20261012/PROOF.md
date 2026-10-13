# Commerce 0.2.0 local pairing

Source pin: merged release f37c9d83a102f7219cd8406986d01d001668c29c, identical
tree to reviewed PR107 head 2b6fe113746db3a5ff7e4345860c5ebadd466c48.

Frozen local inputs (SHA256):
- npm 0.2.0: 6d464546183d56a437393aa21b3f7ec9fdd323add70aaecc5ce696a3ea86c699
- Registry 0.2.0: 436fd1f1d98e7849a23d2376a192f3f536bc84a19301606f106369e354226687
- Route manifest: e641db06c7851bf7e43cbb8ad462610853cced9626b3d4d75ce2dc5a7bc35885
- Backend: cb61336de27ccf6fd6176a10be717b3f31b68ae7524f0710c82539a3c56c33d9 (130990 bytes)

These are frozen local artifacts, not a claim of Registry publication. An
official publication can have different compressed archive bytes;
verify its actual digest and matching source/member bytes before installation.

## Behavior

Four tests first reproduced that Node and Cloudflare middleware blocked retained
start/status requests when readiness was unavailable. The routing fix preserves
the original installed dispatcher, metadata checks when available, native-profile
refusal and public-route boundary. New preparation stays gated by readiness.
Start/status proceed to Commerce's fresh capability/configuration/binding checks.

The real compiled backend loaded in the SDK with the original Registry namespace
passed catalog/readiness/prepare/start/status and one-order replay assertions.
After a valid supported answer, the test ages only its disposable readiness
record and obtains a cached negative binding answer. While the advisory stays
negative, restored service fixtures permit fresh start and status checks. Binding
counters prove those requests revalidate; replay retains one provider session and
one order. All service/DNS transport is intercepted with loopback-only runner I/O.
This is local compiled compatibility proof, not hosted merchant E2E.

Raw logs: ignored runs/commerce-020-pairing-20261012/.


Retained browser recovery is also independent of a stale advisory: preparation
remains forbidden while admission is closed, but a successful authoritative
status can allow the original capability to start. New controller and desktop/
mobile tests reproduce the earlier lock (including a status confirming no
attempt), then prove resumed checkout or paid-order recovery without replacement
capabilities. These browser cases use labeled synthetic transport, not a deployed
merchant service.

## Verification status

- Middleware: four cases reproduced 503 blocking on Node/Cloudflare before fix;
  focused metadata and readiness cases pass after fix.
- Controller: resume with unavailable advisory failed before fix; passed after
  authoritative status was allowed to govern the retained capability.
- Browser: prepared resume failed on desktop/mobile before fix; all four
  prepared/pending recovery cases pass after fix, without extra prepare calls.
- Compiled local 0.2.0 fixture: two tests passed, including fresh binding checks
  while the advisory retains its negative answer.
- Typecheck: zero errors/warnings. Full verification and exact-head review
  receipts are recorded in the ignored run proof after the final revision.
