This is a proposed work order only. No inspection, implementation, or verification has been performed.

The frozen baseline is Template Store `3a93df6ed3ad3dda94182ab0bdf795d360b5df7a`, paired with Commerce source `cbc636eab20ee7759107f3a10ddff776cebe7dd8`. The issue’s `0040061` description is historical. The supplied feature map establishes canonical routing and installed-catalog contracts, but does not prove #34 complete or establish the availability of Commerce #59/#60. Product data/feed verifier checks remain explicitly skipped.

1. **Establish prerequisites and record decisions.**

   In the implementation session, follow the applicable bootstrap instructions, run `./scripts/agent-skills` first, and confirm Node `24.22.0`. Read `design.md`, the feature map, relevant source/tests, and GrillTrack through its CLI. Use `validate`/`show` for ledger reads; record product decisions through GrillTrack before implementation. Do not enable SmokySkills without the required access and immutable pin.

   Work on a focused branch in an isolated, single-owner worktree. Record the exact repository, branch, worktree, and source revisions.

   Discover, without requiring owner decisions on routine technical details:

   - Whether #34’s canonical resolver satisfies published-link uniqueness, redirect, and preview requirements.
   - Commerce #59’s supported builder, public exports or installed routes, policy records, revision semantics, and required product fields.
   - Commerce #60’s feed formats, eligibility rules, canonical-link input, route declaration, and installed public access.
   - Existing EmDash page-rendering, trusted canonical-origin, and safe JSON serialization mechanisms.

   Missing upstream capabilities require a precise dependency handoff, not template-owned substitutes. JSON-LD and policies may proceed before the feed if their prerequisites are satisfied.

2. **Implement Product JSON-LD through Commerce authority.**

   Integrate through the owning features’ declared public entries. Use the existing canonical product resolver and supported Commerce builder; never hand-assemble Product/Offer data or import package internals.

   Every published `/products/{slug}` page must contain exactly one `application/ld+json` Product block. Its name, SKU, optional GTIN, price, currency, and availability must match the shopper-visible facts; its `url` must equal the canonical URL. Resolve editorial-title and Commerce-data differences through supported interfaces, preserving EmDash’s merchandising ownership and Commerce’s transactional authority.

   Unlinked and preview entries must emit no Offer. Preserve invalid/duplicate-link refusal, redirect behavior, noindex defaults, and unavailable-data failure behavior. If the supported public projection lacks required fields, document that upstream gap rather than inventing values.

3. **Render both policy pages from Commerce records.**

   Add shipping and returns as EmDash pages using the established composition/rendering mechanism. Keep human-authored composition in EmDash and policy facts in Commerce.

   Render policy facts and generate `shippingDetails`/`hasMerchantReturnPolicy` references from the same Commerce policy revision. Use the upstream revision contract to prevent inconsistent reads. Editing the policy once must update both page content and structured data.

   Add neutral seed content stating that policy is not configured; include no invented rates, countries, or return windows. Preserve existing edited CMS content and avoid wholesale seed imports. Discover the supported page-provisioning/update path.

4. **Expose the Commerce feed through its supported public boundary.**

   Select and record the stable, slashless URL after inspecting the actual Commerce route contract. Delegate feed generation and channel eligibility to Commerce. Feed links must equal the canonical product URLs.

   Verify that the installed public dispatcher and declared route boundary admit the feed. Update route-policy expectations only from supported declarations; do not introduce a plugin-wide bypass, native fallback, direct storage access, or invented endpoint. Policy-generation changes do not authorize live Access changes.

5. **Verify behavior and preserve required regressions.**

   Add deterministic checks for builder integration, canonical parity, safe script serialization, optional GTIN, preview/unlinked Offer suppression, policy revision consistency, unconfigured policies, and Commerce-defined channel eligibility.

   Desktop Chromium and mobile browser tests must parse the rendered JSON-LD and compare it with visible product facts, including price and availability. Exercise policy edits and confirm both policy-page output and JSON-LD reflect the updated revision. Verify feed URL behavior, public admission, canonical links, and exclusion of channel-ineligible products.

   Extend `bin/verify-site` with the implemented #35 checks. Retain explicit dependency skips for unfinished portions; skipped acceptance is not completion.

   Run the canonical `bin/verify-web` checks and `pnpm verify` before closeout. Preserve the required managed `8 → 5 → 8` sequence and unmanaged availability cycle without quantities. Prove shipping through installed Commerce with Inventory off, no native mount or proof-adapter bootstrap, and fail-closed behavior when Commerce is absent.

6. **Deliver reviewable changes and bounded proof.**

   Update feature ownership, public entries, verification instructions, and GrillTrack records. Submit a focused PR with tests and curated text proof under `.grilltrack/proof/`; keep routine screenshots and generated output ignored in their prescribed locations.

   Distinguish source-development evidence from installed-artifact evidence. A paired clean-install claim requires the Commerce owner’s immutable artifact identity and digest. Report unresolved dependencies explicitly.

   No channel account connection, publication, deployment, production mutation, permissions change, or merge is authorized. Preview and production verification remain subsequent authorized stages.