Work order for `dinkuskit/template-store@0040061283f748b00d23a33a17b421ec01ba7e6f`. This is a plan only; no source inspection, implementation, checks, or external actions have occurred.

1. **Establish the implementation baseline.** Use a focused branch and isolated, single-owner worktree based on the exact source above. Follow the immutable Agent Contract, then `design.md`, `FEATURE_MAP.md`, the GrillTrack ledger, and source/tests/proof. Read the unsupplied files before implementation; their contents are not established by this replay. Resolve product decisions through GrillTrack before implementation, changing its ledger only through the CLI. Preserve existing feature ownership and public entry boundaries.

2. **Add `bin/verify-site <origin>`.** Use the same checks for local, preview, and production origins. Permit only GET/HEAD against public routes; exclude admin and mutation routes, including redirect destinations, before requesting them. Do not invoke proof actions or bootstrap storage. Produce a readable report identifying the origin, checks, offending URLs, redirect chains, failures, and dependency skips. Exit non-zero for any active check failure or incomplete verification caused by request/parsing errors.

3. **Implement the public URL checks.**
   - Crawl from `/` and `/sitemap.xml`, following discovered public internal links and sitemap entries. Inspect redirect responses explicitly.
   - Require internal links to resolve to 200 or an intended redirect. Reject `%2F` paths and trailing-slash URL variants other than `/`.
   - Require sitemap URLs, canonicals, and internal links for each page to be byte-identical. Do not normalize discrepancies away.
   - Require every sitemap URL to return 200, be self-canonical, and lack `noindex`, except for the specified demo-host exception. State explicitly in the report when that flag is active.
   - Require the homepage at `/`; `/home` must not return 200 or appear in the sitemap.
   - Require each product to have exactly one 200 URL under `/products/{slug}`. Check known legacy `/shop/{id}` redirects and legacy digest collection redirects to `/collections/{slug}`.
   - Accept redirect status codes 301 or 302 only, require the correct `Location`, and reject 301 responses with `Cache-Control: immutable` or a long `max-age`.
   - Verify that `/robots.txt` and `/sitemap.xml` are reachable through the public boundary and are supplied by EmDash’s built-ins. Establish built-in ownership through source/integration evidence as well as HTTP behavior.

4. **Implement structured-data verification with explicit dependency handling.** Require exactly one `Product` JSON-LD block on each product page, with SKU, price, and availability matching the visible page and, once #35 lands, its feed representation. Consume supported public surfaces; do not substitute direct Commerce storage access or invented catalog authority.

   Write checks dependent on unlanded #34/#35 work now as narrowly identified expected failures or skips. Each must name its dependency, missing behavior, and activation condition. Keep independent checks active. Once the dependency lands, enable its assertions; an unexpectedly passing expected failure must trigger removal of the exemption. A run with pending contract checks must report that qualification remains incomplete.

5. **Integrate and document.** Have `bin/verify-web full` run the verifier against the local built server, with failures propagated and server cleanup preserved. Update `FEATURE_MAP.md` to identify `bin/verify-site`, its ownership and verification role, and the required order: local → preview → production. State that deployment is complete only after the same verifier passes against production. Preserve `bin/verify-web` as the canonical verification entry.

6. **Verify and prepare review evidence.** Add deterministic HTTP fixtures covering successful behavior and each failure class above, including unsafe redirect destinations and dependency reporting. Add local built-server integration coverage. Before implementation closeout, run `pnpm verify` and retain desktop Chromium/mobile browser proof. Preserve the existing shipping Products admin-to-storefront proof without Inventory configuration/network or proof bootstrap, and the explicit development profile’s managed `8 → 5 → 8` and unmanaged availability cycle without quantities. Those existing mutation-based proofs remain separate from the read-only site verifier.

   Record exact source identity, commands, outcomes, skips, and reports. Keep curated text proof under `.grilltrack/proof/`; generated artifacts and routine screenshots remain in the prescribed ignored locations.

7. **Bounded prerequisites and authority.** Before affected assertions can be finalized, establish #34/#35’s actual contracts and landing status, authoritative legacy URL mappings, the feed route/schema, the demo-host flag semantics, and the threshold defining “long max-age.” Use existing source contracts where available; unresolved product choices go through GrillTrack rather than invented defaults. Preview and production runs require their actual origins.

   Prepare reviewable changes and a PR description; PR creation requires separate authorization. Deployment, publication, production mutation, secrets/permissions changes, and merges also remain separately gated. A read-only production verification neither deploys nor grants those authorities. No result here establishes paired artifact, Registry, checkout, or Cloudflare readiness.