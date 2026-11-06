# Playground build handoff qualification

The real artifact-service roundtrip passes, and one cold local pair measured a faster artifact consumer. This supports the bounded optimization; it does not establish whole-hosted-workflow, functional-equivalence or invoice savings. Deployment and merge have not been exercised by this proof.

Base: `baf1e31876733f6c1fc97238c59b83a86358b841`. Implementation source: `369642f330c9929c3148d26b453e54f85a5d493a`. Hosted and paired evidence below bind `d267be86e97ac8ef2ee8856d0c964b315095c80a`. This new publication changes proof only; workflow, helper, tests and product pins remain byte-identical. Review must bind the new publication head.

The build still prepares pinned Commerce, Payments and Ship, compiles the playground and removes/verifies SESSION. Deployment retains locked dependencies, configuration verification, exact source stamps, Store verification dependencies, environment/permissions, preview checks and `--keep-vars`. Only its repeated preparation/build/SESSION work is replaced by validated restoration.

## Acceptance and evidence

| Requirement | Populated passing evidence | Refusal or limit |
| --- | --- | --- |
| Preserve deployment and verification boundaries | Existing guard tests and canonical verification pass | Draft, verification-only, fork and disabled deployment remain blocked |
| Complete immutable output | Real hosted 823-file artifact download, matching external manifest SHA and restored Wrangler dry-run pass | No live deployment or fresh consumer partial-rerun exercise |
| Integrity and input provenance | Exact source/run/trust/toolchain/control inputs; independent source-blind 44/44 cases pass | Changed inputs, missing trusted SHA, corrupt/additional members, protected files, links, SESSION and external paths refuse before restoration |
| Preserve regular output semantics | Bytes, hidden output, executable modes and empty directories survive populated fixture and real ZIP restoration | Destination output already present refuses and remains intact |
| Measure consumer work | One cold local pair: 76.882s baseline versus 15.309s candidate, including common setup and dry-run | One pair, variable public fetching; raw independent-rebuild output differs and was not normalized |
| Full product verification | 578 unit tests; 115 workflow passes/2 skips; 131 browser passes/9 skips across desktop/mobile and both shipping projects; 32-URL crawl/0 failures/2 skips | Full local run took 650.293s at implementation source; not comparable to hosted split-job timing |

## Hosted service roundtrip

[Hosted receipt](hosted-roundtrip.json), [job 128099241083](https://github.com/dinkuskit/template-store/actions/runs/42277988720/job/128099241083): source `d267be8`, success, 823 files/39,348,043 bytes. Packaging, upload, download and restoration use the same external manifest SHA `676b6b8592b8bebc356ccdcb8fba8f45ad8f1e0af65f9646a0491aae2e428c1c`.

| Added proof phase | Rounded seconds |
| --- | ---: |
| Package | 1 |
| Upload | 3 |
| Download | 2 |
| Restore plus credential-free Wrangler dry-run | 4 |
| Total additional proof path | 10 |

This is the existing producer job's non-deploying proof path. The normal eligible-deployment path omits that extra proof dry-run. Restore group start to its JSON receipt was approximately 0.719s, including launch; it is not an exact process timer. The 98s job envelope and 37s preparation/15s build are observations, not a paired consumer baseline. Timestamps are rounded, not billing measurements.

## Cold paired consumer

[Paired receipt](paired-consumer.json) records exact pins, control hashes, inventory digests, public commands and all phase results. Both consumers use fresh source checkouts and separate HOME/XDG/npm/tmp state. The existing frozen root dependency installation is independently reflink-copied; root `pnpm install` and `pnpm verify:playground-config` are shared prequalified inputs, not reexecuted. The baseline runs the actual cold `pnpm prepare:sources`, including its pinned public Commerce `npm ci`, followed by fresh compilation, unchanged SESSION removal and credential-free Wrangler dry-run. The candidate extracts the actual final-source producer artifact, validates/restores it and runs the same dry-run.

| Measured boundary | Baseline | Candidate |
| --- | ---: | ---: |
| Checkout and locked root dependencies | 2.638s | 2.692s |
| Consumer workload, including dry-run | 74.245s | 12.617s |
| Full boundary | 76.882s | 15.309s |

Observed local consumer difference: **61.574s**. Producer packaging **1.218s** and ZIP creation **1.512s** are separate added local costs. Candidate extraction **0.255s** is already included. The candidate dry-run took 10.740s versus 2.774s for the baseline; that variation was retained. Public fetching/cache effects varied substantially, so this one pair does not predict hosted or invoiced savings. Hosted upload/download costs are separate cross-environment observations and are not subtracted from these local numbers.

The candidate exactly matches its 823-file producer. The independent rebuild differs in five inventory entries; the first-pair stop remained in force. Raw inventories were not normalized into an equality claim:

- The substantial middleware body changes only in its 13-digit `buildTime` literal. Pinned EmDash 1.4.0 obtains this value using `Date.now()` in `src/astro/integration/vite-config.ts` and emits it from `src/astro/integration/virtual-modules.ts`. This changes the content-hash module names and references.
- Entry-module differences are exactly the observed middleware filename substitutions. That is an explanatory reference check, not replacement of raw comparison evidence.
- Pinned Astro 7.1.3 uses `createKey()` when no `ASTRO_KEY` is set (`dist/core/build/index.js`); `dist/core/encryption.js` generates an AES-GCM key. The virtual manifest contains the expected changed generated key, changed middleware reference and reordered unchanged literals. Key values are not published.

These source-backed build variations explain the observed mismatch without asserting new browser/runtime equivalence across the separately built artifacts. Both credential-free Wrangler dry-runs pass. Source hashes and raw-inventory digests are retained in the paired receipt; full inventories and logs are not published. All 16 measured phases are terminal, and the original source/types remain unchanged.

## Other proof and retained contracts

- [Canonical verification](canonical-verification.json), [initial real ZIP/dry-run](local-roundtrip.json) and [independent source-blind proof](source-blind/report.json). The latter's five self-consistent simulated-producer cases remain distinct from real pack-output digest cases.
- [Historical hosted baselines](hosted-baseline.json): repeated preparation/build measured 42s, 44s and 42s. At exact base run [42085964891](https://github.com/dinkuskit/template-store/actions/runs/42085964891), 42s is only 3.74% of 1,122 aggregate job-seconds before new costs. No paired whole-workflow or invoice comparison is claimed.
- [Download action manifest](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml) and [implementation](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/src/download-artifact.ts): immutable Node 24 revision, current-run defaults, no new token input/permissions; helper validation independently fails closed.

Trusted producer outputs bind artifact name, producer attempt and manifest SHA. Restore checks the external SHA before parsing, then verifies context, controls, member hashes and closure. Earlier successful producer attempts can be accepted locally; actual hosted partial-rerun behavior remains unobserved. Three-day expiry means a later partial rerun must rebuild the producer/all jobs. Upload is limited to eligible deployment or explicit same-repository draft/verification-only proof; forks and ordinary disabled ready PRs do no artifact work. Preserve `verification-only` through closeout. Review, merge and deployment gates remain unchanged.
