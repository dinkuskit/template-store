# Access route policy checker (#45, PR47)

`scripts/verify-access-routes.mjs` derives the store's Cloudflare Access exceptions from plugin route declarations instead of a hand-typed list. Checkout off: no `/_emdash` exceptions. Checkout on: only exact public routes. It changes no live Access application and performs no deployment.

## What fails closed

- A Commerce route without an explicit `public` declaration (today the pinned Commerce `admin` route, pending dinkuskit/commerce#79) is listed as undeclared and fails `--check`.
- A Commerce route id that cannot be resolved from any Commerce source file is listed under `unresolvedRouteIds` and fails `--check`. It is never emitted as a path. Earlier heads read four fixed files; against Commerce main `554e085` the store-policies route came out as a public bypass for an `UNRESOLVED:` path while `--check` passed. Commerce main now resolves `policies/public`.
- Every public route, Commerce or Payments manifest, must be one exact literal path (no `*`, `{...}`, `<...>`, query, space, `//`, `.`/`..` segment or trailing slash) with explicit HTTP methods. A `registry` route must sit under one named plugin. A `hosted` route must not be an `/_emdash` path. A Payments route must declare `auth`. Anything else is listed under `invalidPublicRoutes`, kept out of `checkoutEnabled.bypasses`, and fails `--check`.
- Tracked deployment text containing a plugin-wide wildcard bypass fails `--check`.

## Evidence

`tests/workflows/access-route-policy.test.mjs` (4 tests):
1. pinned Commerce `938cb06` yields exactly the five shopper routes (catalog public and item GET, guest prepare/start/status POST), no Payments routes and `admin` as undeclared;
2. `--check` fails on the undeclared route;
3. a fixture Commerce tree resolves a route id from a nested module and refuses an unknown id;
4. a fixture Payments manifest with a plugin-wide wildcard, a plugin wildcard, a `{siteId}` placeholder, an unauthenticated webhook and a plugin-root path emits only the one exact authenticated webhook; `--check` fails naming the refused routes.

CI `Store verification` on git:3a15126a7a562badc4410dece0a531fc7ea29d1b (job 114034488317, Node 22.23.2) ran full `pnpm verify`: 172 unit tests in 25 files, 21/21 workflow tests including the four above, feature and worktree-text audits, production build, 23 browser tests passed with 3 skips, `verify-site` passed, `verify-web: full passed`.

## Not covered

`pnpm verify:access-routes` intentionally fails on the current Commerce pin until commerce#79 declares `admin`. Payments publishes no route manifest yet (payments#27). Production `verify-site` Access assertions from #45 are not in this PR, so #45 stays open. No Access rule was changed.

## Authority boundary (review revision 3)

The Commerce side is read from the pinned source checkout, not from the artifact a store has installed, so it cannot be live Access authority (AGENTS.md: source-pilot checks do not establish Cloudflare readiness). The JSON output now carries `authority: { kind: "source-pin", commerceSourceCommit, deploymentReady: false }` and the markdown output is titled a preview that names the source commit and says not to apply its rows. DEPLOY.md states the rule (checkout off: no exceptions; checkout on: only exact public routes from the installed artifacts) and says checkout-on Access exceptions wait for the installed Commerce route manifest with immutable artifact identity and digest (dinkuskit/commerce#79). Test 1 asserts the source-pin authority, a 40-character source commit and `deploymentReady: false`.
