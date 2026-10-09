# Deployment and Cloudflare Access

This repository does not change a store's live Cloudflare Access applications.

## Rule

1. With `PAYMENTS_UNAVAILABLE=1` (the shipping default), keep all of
   `/_emdash*` behind Access. There are no exceptions, and nothing needs to be
   generated.
2. When checkout is enabled, add only the exact routes marked `public` by the
   **installed** Commerce and Payments artifacts. Never create a plugin-wide
   exception.

## Source preview (not deployment authority)

```sh
pnpm verify:access-routes
node scripts/verify-access-routes.mjs --format=markdown
```

The checker reads Commerce's pinned source checkout
(`.artifacts/source-deps/commerce`, prepared from `package.json`
`dinkuskit.sourcePins.commerce`), not the Commerce artifact a store has
installed. Its output is a review preview: it reports
`authority.kind: "source-pin"`, the exact source commit, and
`authority.deploymentReady: false`. A source pin can differ from what a store
runs, so this output must not be applied as live Access rules. Checkout-on
Access exceptions wait for the installed Commerce route manifest with an
immutable artifact identity and digest (dinkuskit/commerce#79), matched to the
store's installed release.

Preview from the current pin (review only):

   - `/_emdash/api/plugins/dinkus-commerce/catalog/public` (`GET`)
   - `/_emdash/api/plugins/dinkus-commerce/catalog/public/item` (`GET`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` (`POST`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` (`POST`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/status` (`POST`)

   These are generated from `src/plugin.ts` and its route-id exports; the list
   above is only a review snapshot. The script fails if the source exposes a
   route without an explicit public/admin declaration.
Payments issue #27 currently publishes no public Registry plugin routes.
   Its provider webhooks are hosted routes, not `/_emdash` routes. The paired
   Payments artifact must supply its exported manifest to the checker:

   ```sh
   node scripts/verify-access-routes.mjs \
     --payments-manifest=path/to/payments-route-manifest.json \
     --format=markdown
   ```

   Never copy a site-id placeholder into Access. The Payments manifest must
   emit the concrete server-owned webhook path for the store (for example the
   Authorize.net hosted route includes the site id) and its
   `auth: "provider-signature"` authentication requirement. Each manifest route is
   `{ "path", "public", "method" | "methods", "surface": "registry" | "hosted", "auth" }`.
   The checker treats the manifest as untrusted: a public route becomes a
   bypass only when its path is one exact literal path (no `*`, `{...}`,
   `<...>`, query or trailing slash), it names explicit HTTP methods, a
   `registry` route sits under one named plugin, and a public Payments route
   declares exactly `auth: "provider-signature"`. Anything else is listed as
   refused and fails `--check`.

`verify:access-routes` is intentionally fail-closed against the current
Commerce pin until upstream issue #79 adds the missing admin declaration and
published route manifest. This is a release prerequisite, not permission to
interpret an undeclared route as public. The policy checker audits only the
actual deployment-policy inputs at the repository root: `DEPLOY.md` and
`wrangler.jsonc`. It rejects concrete named-plugin wildcard paths (for
example, a named plugin followed by `/*`); tests, proof, and source fixtures
are outside this audit scope.

After the installed-manifest policy has been reviewed, a separately
authorized operator may apply exact Access rules and run the production `bin/verify-site`
checks. No Access or deployment mutation is performed by this repository
change.
