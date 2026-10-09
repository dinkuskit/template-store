# Deployment and Cloudflare Access

This repository does not change a store's live Cloudflare Access applications.
Before enabling a deployment, generate the route policy from the paired
installed plugin artifacts:

```sh
pnpm verify:access-routes
node scripts/verify-access-routes.mjs --format=markdown
```

The generated policy is the source for the Access change:

1. With `PAYMENTS_UNAVAILABLE=1` (the shipping default), keep all of
   `/_emdash*` behind Access. The checkout-disabled bypass list is empty.
2. When checkout is enabled, add only the exact routes marked `public` by the
   installed Commerce and Payments manifests. Do not create a plugin-wide
   exception.
3. The current pinned Commerce source derives these exact shopper paths:

   - `/_emdash/api/plugins/dinkus-commerce/catalog/public` (`GET`)
   - `/_emdash/api/plugins/dinkus-commerce/catalog/public/item` (`GET`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` (`POST`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` (`POST`)
   - `/_emdash/api/plugins/dinkus-commerce/checkout/guest/status` (`POST`)

   These are generated from `src/plugin.ts` and its route-id exports; the list
   above is only a review snapshot. The script fails if the source exposes a
   route without an explicit public/admin declaration.
4. Payments issue #27 currently publishes no public Registry plugin routes.
   Its provider webhooks are hosted routes, not `/_emdash` routes. The paired
   Payments artifact must supply its exported manifest to the checker:

   ```sh
   node scripts/verify-access-routes.mjs \
     --payments-manifest=path/to/payments-route-manifest.json \
     --format=markdown
   ```

   Never copy a site-id placeholder into Access. The Payments manifest must
   emit the concrete server-owned webhook path for the store (for example the
   Authorize.net hosted route includes the site id) and its provider-signature
   authentication requirement. Each manifest route is
   `{ "path", "public", "method" | "methods", "surface": "registry" | "hosted", "auth" }`.
   The checker treats the manifest as untrusted: a public route becomes a
   bypass only when its path is one exact literal path (no `*`, `{...}`,
   `<...>`, query or trailing slash), it names explicit HTTP methods, a
   `registry` route sits under one named plugin, and a Payments route declares
   `auth`. Anything else is listed as refused and fails `--check`.

`verify:access-routes` is intentionally fail-closed against the current
Commerce pin until upstream issue #79 adds the missing admin declaration and
published route manifest. This is a release prerequisite, not permission to
interpret an undeclared route as public. The policy checker also rejects
plugin-wide wildcard text in tracked deployment policy files.

After the generated policy has been reviewed, a separately authorized
operator may apply exact Access rules and run the production `bin/verify-site`
checks. No Access or deployment mutation is performed by this repository
change.
