# Workers Builds source admission

A real provider diagnostic reported an exact expected Git HEAD but a different,
four-character injected commit stamp. The stamp's literal value was not read or
inferred. A strict stamp comparison therefore rejected the correct checkout.

The source guard now requires, in Workers CI:

- Required full expected commit, exact injected branch and expected account.
- The actual project-root Git checkout, a matching committed HEAD and tree,
  and no staged or working changes to tracked source.
- Missing Git, wrong root, wrong HEAD, dirty tracked source or invalid scope
  refuses before config generation/application build, with sanitized errors.

The injected commit stamp is left untouched and contributes no admission
permission. Receipts report only its observational role, length and whether it
matches the verified checkout. Mismatch/missing cases warn without raw values.
Detached checkouts work. Local non-Workers-CI behavior is unchanged and needs no
Git identity. Account/Worker/profile/resource configuration remains separate;
this guard does not claim permission to deploy or access provider resources.

## Executed focused verification

Node22.23.2: `node --test tests/workflows/registry-build.test.mjs` — 11 pass.
The test creates disposable real Git repositories containing the actual consumer,
then invokes both its exported guard and CLI. These are synthetic local fixture
metadata, not observations of a new provider build.

- Clean actual HEAD with short, missing and matching injected stamps passes;
  the original environment object remains unchanged and receipt metadata is exact.
- Wrong actual HEAD rejects even with a matching provider/expected stamp.
- Staged and unstaged tracked edits refuse before any config is written.
- Untracked generated output is allowed without changing tracked cleanliness.
- Wrong/missing branch, commit and account scope refuses.
- Missing Git, nonrepository, missing checkout and wrong project root refuse;
  CLI errors contain no Git details or raw stamp values.
- A short-stamp CLI success emits only the safe JSON receipt plus a bounded
  stderr warning; account binding remains the supplied exact target.
- Existing Registry resource validation, stable/beta profile behavior and
  opt-in Access tests remain passing. No runtime/plugin behavior was changed.

The final owner packet retains full required verification, exact new-head
real-ID beta build/artifact proof and current CI/OpenClaw/native reviews before
handoff. This source change does not modify deployment workflows. Merging main
still triggers the separately enabled shared playground deployment after CI;
verification-only suppresses PR previews, not push-to-main deployment.
No merge, deployment, provider probe or account mutation was performed here.
