# Reject mismatched artifact context before expensive validation

The consumer still verifies the trusted producer manifest hash before parsing.
A pure projection of the existing ten context fields now rejects a mismatch
before Git, toolchain and control-file checks. A context match proceeds through
every existing full-input, payload, closure and destination check. Earlier trusted
producer attempts remain supported; workflow, pins, permissions and gates do not
change. Wrong-context errors can now precede local checkout/toolchain errors.

Base: `b9eecb7aea06b27b88a984d6731e97fa2534a2a7`. Baseline helper SHA-256:
`5d33fd01bfbe547157e531c6123efd68e1705ad9fddd100a02e7d44a1cd09611`.
Measured candidate helper SHA-256:
`1a9a62f80e0b32c0f62517a2261fc195fbd974c14329efcb93f148bf3d7f856d`.

## Comparable local measurements

Command: `node --test tests/workflows/playground-build-artifact.test.mjs`, using
Node 24.22.0 / pnpm 11.9.0. Acceptance was declared before candidate measurement:
at least 1s and 5% median elapsed reduction, no systematic CPU increase above 5%,
and all 11 cases preserved. Each invocation created fresh synthetic Git fixtures.
The same checkout and tools were used, with an exact baseline helper-file
overlay. The test file stayed byte-identical throughout B,C,C,B. Dependencies
and operating-system caches were warm; the command ran without network access.

| Sample | Elapsed seconds | Waited-child CPU seconds | Passed |
| --- | ---: | ---: | ---: |
| Baseline1 | 9.382 | 12.693 | 11 |
| Candidate1 | 7.707 | 10.496 | 11 |
| Candidate2 | 7.573 | 10.532 | 11 |
| Baseline2 | 9.015 | 12.444 | 11 |

Median elapsed improved 9.199→7.640s: 1.559s / 16.94%. Both pairs improved
(1.675s and1.442s); median waited-child CPU decreased 16.35%. These figures
qualify this artifact-test workload only. Source-derived counts for the common
workload predict five fewer pnpm and 37 fewer Git launches; no process tracer was
available, so these are not presented as observed counts. Successful production
restores still run full validation; total workflow time and billing are unmeasured.
Exact values, case-name digest and source hashes are in
[measurements.json](measurements.json).

## Validation and remaining gate

After timing, focused assertions were added within the same 11 test cases: a
wrong context rejects before a dirty-checkout error; matching context still
rejects the dirty checkout; trusted null/missing input contexts fail closed.
All 11 cases passed again in 7.387s, including original SHA-before-parse, earlier
producer, ZIP/mode/hidden-file closure and destination-preservation cases.
This last run validates additional assertions, not another paired sample.

Full `pnpm verify` is pending on the frozen committed head. Its terminal result
and hosted exact-head CI/review evidence must be read from the PR/current run
records before closeout. The separate mobile-build experiment was withdrawn;
its [rejection proof](../ci-mobile-build-20261107/PROOF.md) is retained.
