# Mobile production-build experiment: withdrawn

Base: `b9eecb7aea06b27b88a984d6731e97fa2534a2a7`. Measured candidate:
`816bae8787afc1ea96a3f9c5abc86d4385a30ee5`. The candidate is reverted;
normal mobile verification again performs its existing production build.

The declared acceptance required at least 5s median paired elapsed improvement,
no systematic CPU increase above 5%, and unchanged cases. The exact command was
`bin/verify-web browser`, with
`VERIFY_E2E_PROJECTS=chromium-mobile,shipping-chromium-mobile`, Node24.22.0 and
pnpm11.9.0. The controlled overlay used the same candidate checkout and locked
runtime/dependencies, substituting only the exact base verifier for baselines.
This was not a pair of clean-commit executions.

| Sequential sample | Wall seconds | User + system CPU seconds | Production builds |
| --- | ---: | ---: | ---: |
| Baseline1 | 344.146 | 218.029 | 1 |
| Candidate1 | 325.338 | 213.985 | 0 |
| Candidate2 | 325.125 | 200.540 | 0 |
| Baseline2 | 302.593 | 214.913 | 1 |

All four completed with the same 70 unique case identities, 65 passes and five
expected skips, one worker and zero retries. Candidate runs kept `dist` absent.
Focused guard tests passed 5/5 on the candidate. Shared source/plugin preparation
and one build warmup preceded measurement. Non-dist Astro, migration and default
Vite/database caches remained warm; canonical startup recreated both profile
stores for each sample. CPU is the capture helper's waited-child measurement.

Pair1 saved 18.808s; pair2 regressed 22.532s. Baselines varied by 41.553s, much
more than the 5.32s internal build phase observed in baseline1. Median command
time increased 1.862s. Removing one build did not establish a reliable net
elapsed benefit. Candidate1 additionally followed an interrupted13.727s attempt
that reached preparation/server setup but no test case; its possible warming
is retained as a qualification. A third baseline was cancelled after32.427s
and excluded; no further timing was used to select a favorable result.

Full cold-start qualification was not completed for this withdrawn patch.
No hosted workflow, critical-path or invoice improvement is claimed. Original
verifier behavior, workflow comment and test inventory are restored. Compact
exact values and limitations are in [measurements.json](measurements.json).
