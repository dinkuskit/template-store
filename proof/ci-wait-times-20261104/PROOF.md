# Template Store welcome-wait improvement

Status: local verification qualified. This immutable snapshot records prepublication proof; the pull request owns current hosted CI and exact-head review receipts.

## Scope

The candidate centralizes first-login welcome handling for the three affected browser specs. It observes the real `GET /_emdash/api/auth/me` response, dismisses the dialog only when `isFirstLogin` is true, and otherwise verifies the already-dismissed state. Missing or malformed auth state fails by code instead of being treated as dismissal. The product assertions, guest-cart deadlines, and original 30-second welcome budget are unchanged.

Base: `b1789ce2c6652309d2b08efeaec1bb56dd1f90a4` (fixed base HEAD). Tested source identity is the file-hash table below; the published PR head identifies the containing commit.

## Source parity

| Tested source | SHA-256 |
|---|---|
| `tests/e2e/helpers/welcome.ts` | `4b1cbf4cd8b63dd51db4e846e71a72336427c3bf7d5d2fa52f22e8d6ea083f4b` |
| `tests/e2e/admin-product-categories.spec.ts` | `094793c21d86a9935feaa3ed6db7be8d3b5d9d0e732a88cd08040757fe56d017` |
| `tests/e2e/home-opener-section.spec.ts` | `6869fa43317b20cec181f211de36871da5d028e436fe9fc7a853464528aa158a` |
| `tests/e2e/upstream-blocks.spec.ts` | `1ffa7c4525f5f42d8ce954ad88c0714ac217253344395a64ff2786ad9be12bc2` |

The independent parity record says product-test bodies are unchanged after removing only observer arming; helper bodies intentionally change.

## Measurements

Focused runs used the same three specs, Chromium desktop, serial execution, warm installed dependencies, preserved HOME, Node `24.22.0`, and pnpm `11.9.0`:

| Sample | Runs | Wall seconds | Result |
|---|---:|---:|---|
| Baseline | 135.5568001, 135.2638827 | mean 135.4103414 | 3 passed / 1 existing skip each |
| Candidate | 54.3110468, 53.4881186 | mean 53.8995827 | 3 passed / 1 existing skip each |

Observed focused reduction: **60.195%**, **81.5108 seconds saved**. This is a local measurement, not a CI-cost or statistical claim.

The baseline full run was `610.5808407s`; the accepted fresh candidate full run was `422.8352312s`, an observed difference of `187.7456095s`. Each is one full sample. Both had 578 unit passes, 131 browser passes, 9 existing browser skips, all four projects, and site verification of 32 URLs with 0 failures and 2 skips plus valid feeds. Full proof observed desktop, mobile, and shipping profiles.

The earlier candidate full sample at `429.6713698s` is excluded: its final-site comparison was invalid because the baseline had an orphan on the assigned port. The accepted fresh run began with its intended loopback ports empty; parent acceptance evidence verified final cleanup. No machine, account, local path, trace, or screenshot details are published here.

## Acceptance-to-proof

| Requirement / source | Expected fact | Populated passing case | Adverse/refusal case | Capable environment and evidence |
|---|---|---|---|---|
| Pinned `emdash@1.4.0` auth route (source hash in JSON); `AGENTS.md` proof method | Real auth response determines first-login state; no response is not dismissal | Correctness trace covers fresh welcome dismissal and already-dismissed continuation | Missing/malformed auth state fails by code; this is not claimed as a runtime adversarial test | Chromium desktop, serial Playwright; correctness receipt and sanitized hashes in `measurements.json` |
| Four tested source hashes and parity record | Only welcome waiting/observation changes; product bodies remain equivalent | All four candidate hashes match the supplied tested snapshot; 3-pass/1-existing-skip focused runs | Existing skip remains disclosed, not counted as a pass | Node `24.22.0`, pnpm `11.9.0`; source hash table and parity record |
| Wait-time improvement | Focused elapsed time decreases without changing the 30s assertion budget | Two baseline and two candidate receipts show the measured means above | Invalid candidate full sample is excluded rather than silently compared | Same local serial harness; receipt paths and SHA-256 values in `measurements.json` |
| Full verification boundary | Fresh full candidate exercises desktop/mobile/shipping and site/feed checks | Accepted fresh full receipt: 578 unit, 131 browser, 9 existing skips, 32 URLs, 0 failures, 2 skips, valid feeds | No claim is made for CI generalization; public CI remains pending | `./bin/verify-web full`; sanitized accepted receipt metadata and parent cleanup record |
| Type correctness | Final typecheck passes after annotation repair | `pnpm exec astro check` final receipt exits 0 | Initial typecheck failure is reported as an annotation issue only | Existing typecheck receipts; no runtime-fix claim |

## Reproduction and evidence inventory

Commands used by the already-tested work, recorded here for review (not rerun during packaging):

- `pnpm exec playwright test tests/e2e/admin-product-categories.spec.ts tests/e2e/home-opener-section.spec.ts tests/e2e/upstream-blocks.spec.ts --project=chromium-desktop --reporter=line`
- `./bin/verify-web full`
- `pnpm exec astro check`

Exact receipt-relative paths and raw capture SHA-256 values are in `measurements.json`; ignored raw run directories are not linked as published artifacts. The parent acceptance records are external read-only inputs. Live hosted CI and exact-head review receipts are recorded in the pull request.
