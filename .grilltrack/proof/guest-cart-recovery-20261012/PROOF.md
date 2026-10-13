# Retained guest checkout recovery

PR80 originally hid recovery when retained checkout state had no attempt ID.
The controller deliberately keeps starts locked across reload until Commerce
status distinguishes a prepared capability from an ambiguously completed start.
The missing control therefore stranded both cases.

## Reproduction and repair

At original head f8d96dcc43fe13283f8a485a6345e04565ecd4a6, four new browser
cases failed: prepared-capability reload and lost-first-start-response reload,
each on desktop Chromium and a mobile viewport. DOM snapshots and screenshots
showed disabled quantity, contact, and checkout with no recovery button.

The repair displays recovery for every valid retained capability and uses
neutral status-check wording. No controller permission, capability, price,
order, or idempotency rule changed. Current main was merged into the branch,
including its verification-only CI policy.

The same four cases then passed. The prepared case retained its capability and
used one status call before controls unlocked, with one total prepare and zero
starts. The lost-response case retained awaitingStart with a null attempt ID,
then recovered the original attempt using one status call; it stayed locked and
issued no replacement start or prepare. Both fixtures deny external traffic.

These are browser UI regression proofs with synthetic Commerce responses;
they do not establish installed Registry, Stripe, or merchant end-to-end proof.
Raw logs and before/after captures are in ignored runs/pr80-recovery-20261012/.

## Checks

- Focused browser regression: 4 passed after repair, 4 failed before repair.
- Full verification and exact-head CI/review terminal receipts are recorded in
  the run proof after the final pushed revision completes.
- PR80 is labeled verification-only; deployment and cleanup must remain skipped.
