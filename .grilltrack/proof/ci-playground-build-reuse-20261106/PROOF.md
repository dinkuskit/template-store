# Playground build handoff qualification

Status: candidate under test; no deployment or measured savings claim.
Base: `baf1e31876733f6c1fc97238c59b83a86358b841`.
Scope: same-run build output reuse between the existing Playground build and deployment jobs.

The build still prepares the exact pinned Commerce, Payments and Ship sources, compiles the playground, and removes and verifies SESSION. Deployment still installs its pinned dependencies, validates playground configuration, waits for Store verification and the build, records exact source commits, and retains its existing environment, permissions, preview checks and `--keep-vars`. Its repeated preparation, compilation and SESSION rewrite are replaced by a validated artifact restore. No deployment is authorized by this proof.

The producer emits the artifact name, producer attempt and manifest SHA through job outputs. The consumer checks the external manifest SHA before parsing it, then requires the same repository ID, workflow, run, source head, trust context, toolchain, public build controls and pinned plugin sources. A consumer rerun can accept an earlier successful producer attempt explicitly supplied by those outputs. Future attempts, changed contexts or inputs, missing/corrupt/additional members, protected filenames, links, SESSION and external configuration paths refuse. Existing destination output refuses and remains intact. Modes and empty directories are restored from the trusted manifest; hidden regular output is explicitly uploaded.

Artifacts are retained for three days. A partial rerun after expiry must rerun the producer/all jobs; this intentionally differs from rebuilding inside deployment on any late retry. Actual partial-rerun output reuse remains a hosted qualification dependency.

Uploads are limited to eligible deployment consumers and explicit same-repository draft/verification-only PR proof. Forks and ordinary ready PRs with deployment disabled do no artifact work. The non-deploying proof adds download/restore and a credential-free Wrangler dry-run inside the existing build job; its cost is reported separately from the normal producer/consumer path.

## Acceptance and evidence

| Requirement and source | Passing case | Adverse case | Environment and observed proof |
| --- | --- | --- | --- |
| Existing CI deploy guard, verification dependencies, exact source stamp and keep-vars | Normal enabled main/same-repo ready PR remains eligible | Draft, verification-only, fork and disabled deployment remain blocked | Existing workflow guard tests pass; new admission tests cover artifact work separately |
| Adapter output and Wrangler `no_bundle` closure | Populated worker plus assets and required hidden output | SESSION or references outside dist refuse | Real build succeeds on Linux arm64, Node24.22.0/pnpm11.9.0; clean restored dry-run pending |
| Same-run provenance, source controls and integrity | Exact nonempty fixture restores bytes, executable mode and empty directory | Changed head/run/attempt/trust/toolchain/control, missing external SHA, altered manifest/payload refuse before destination output | Builtin Node workflow tests; independent behavior proof and hosted service roundtrip pending |
| Canonical verification in AGENTS.md | Quick then full verification, desktop Chromium and mobile viewport | Failures/skips remain explicit | Canonical quick passed29.534s after exposing only read-only source Git metadata; full/browser verification pending |
| Reduced total work | Producer pack/upload plus consumer download/restore costs less than removed duplicate preparation/build | No retained optimization if benefit is unproved or complexity outweighs it | Three base hosted runs have 42–44s repeated preparation/build work; this is an opportunity, not observed savings. Actual service timing pending |

## Source contracts

- [Download action v8.0.2 manifest](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml) and [implementation](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/src/download-artifact.ts): immutable Node24 action, current-run/repository defaults, digest mismatch defaults to error. The helper also fails closed on the trusted external manifest SHA and member hashes. No token input or permissions increase.
- [Existing upload action](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02): immutable artifact upload, hidden file inclusion explicitly enabled only for the inventoried payload/manifest.
- [GitHub reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) retain the original SHA/ref; [run attempt](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) increments on reruns. Earlier producer attempt support is explicit; output retention still requires hosted observation.

## Local preparation

Exact official Node24.22.0 arm64 and pnpm11.9.0, frozen lockfile dependencies, inspected better-sqlite3/esbuild/workerd rebuilds. Commands run with personal home/configuration hidden and an allowlisted environment; HOME retains its actual value. Only read-only source Git objects/index/HEAD/task ref are exposed for Git checks, with synthetic non-auth Git configuration. No credentials, deployment or account access are needed.

Preparation31.146s and real playground compilation17.739s succeeded. The initial offline compilation could not fetch Google font metadata and used its existing fallback; it qualifies output shape only, not hosted build equivalence or performance. Output contains807files/38,422,175bytes, including `dist/client/.assetsignore`. Canonical quick passed29.534s: Astro check, Vitest,115workflow tests (2existing artifact-dependent skips), feature audit, text audit and Git whitespace. Pinned Chromium/headless-shell installation succeeded32.833s. Follow-up measurements, full/browser results, exact source and hosted links will be added before review closeout.
