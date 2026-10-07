# Exact pairing and release gates

Original pairing audit: 2026-09-30. Template base at that audit: `41a63299d575eeb9784de700c63ca628543b2d60`.
Current Commerce source identity updated 2026-10-06 to match the template manifest.

| Component | Current identity | Meaning |
| --- | --- | --- |
| TemplateStore | private package `0.0.0`; this candidate source | Development pilot, no approved release |
| Commerce | reviewed source `45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef`; unmerged pre-release candidate; npm archive `e0d1c88ca5cf805f3795aa61ef598f1c50c893be35fd4b41aa0ac867d554e4df`, Registry archive `79b64463dbb7c80012bb13fca613be0954b2387ee5ec5709a4656293dd5cfa3a` | Exact Commerce49 default Registry service assembly adopted for bounded runtime proof; owner artifacts remain pre-release and local admission inputs |
| Payments | reviewed source `37842220fddb10dc5294af084110cd33804715be`; merged `1d7b5521f9986df7b7f92866b43cf7814826d607` | Immutable Payments12 HTTP/JWT/SQLite Worker paired locally with intercepted issuer/provider transport |
| Blocks | EmDash 1.0.1 public native Blocks plus local legacy Portable Text presentation and Unknown fallbacks | No `@dinkuskit/blocks` dependency or registration. Retired pin `fe03bfac91798ac0b411b952fe23c26afefbf570` is historical style provenance only, not a shipping requirement |
| Inventory | source `5889c7d59398376da51ac400d5c1f1214aba2c6b` | Development managed regression only; off in shipping v1 |
| EmDash | package `1.0.1` | Actual tested package; registry-installed pair remains unqualified |

EmDash themes are complete Astro projects scaffolded by create-astro. Its current
registry installs sandboxed plugins. Native plugins instead need built package
exports and registration in Astro configuration. These are distinct distribution
surfaces; a native source alias cannot prove a registry-installed Commerce pair.
All DinkusKit plugins must be registry-enabled. The released template default
must consume actual registry-installed Commerce through supported surfaces.
An SDK import is acceptable only with proof that plugin identity, storage and
route authority match that installed artifact; it cannot silently substitute
a native registration.
[Themes](https://docs.emdashcms.com/themes/overview/),
[registry](https://docs.emdashcms.com/plugins/registry/),
[native distribution](https://docs.emdashcms.com/plugins/creating-native-plugins/distributing/).

The upstream source inspected was EmDash
`998b983b7093e2c5a1f806b09cd8a93bfc33eb0a`:
[starter manifest](https://github.com/emdash-cms/emdash/blob/998b983b7093e2c5a1f806b09cd8a93bfc33eb0a/templates/starter/package.json).
Do not copy its monorepo workspace/catalog dependency specifiers into a distributable starter.

## Required owner handoff

Commerce must supply its public immutable source commit, actual artifact location,
SHA-256, exported storefront/admin/API contract and exact supported EmDash identity.
For a registry bundle include the actual public package name, release version and
verified digest. Do not guess a publisher handle or treat native and sandboxed
storage/API shapes as interchangeable. Template must then consume that exact
artifact, remove temporary source aliases from the shipping package graph, record
its own actual artifact digest, and verify a clean install and upgrade of the pair.
No version or release identifier is reserved by this document.

The current template npm-pack dry run includes verifier scripts and historical
lineage. Before distribution, establish and audit an explicit starter artifact
file list; do not ship proof/rail tooling or credentials. A source archive digest
of the previous Commerce pin (`ab37cd7f362f1c37cb1d321192abbbc48a623833`) is
`d6849c3a50502b4cce7ad98a96ddd7a9c8bbeef7d77e94dfd6980083137cd4f3` (verified
via `git archive --format=tar ab37cd7f362f1c37cb1d321192abbbc48a623833`). This is source provenance only, not a
registry bundle or released tarball digest.

| Gate | Owner / required evidence | Current disposition |
| --- | --- | --- |
| Inventory off | Commerce disabled stock management; Template default profile | Not a blocker for this bounded native qualification (shipping v1 profile operates with Inventory off); final Commerce artifact pending |
| Cart / checkout / orders | Commerce public API, mounted runtime, persisted authority | Final mount and tested purchase/order path pending; no template copy of these models |
| Payment transport | Payments exact test contract and approved timing semantics (1800..1860s window) | Approved window 1800..1860s; local default workerd/Payments bridge and durable wake settlement proven with synthetic identity; installed transport and scheduler activation pending |
| Shipping story | Ship owner contract: fulfillment behavior and supported merchant path | Pending; shipping/contact/tax owner paths unqualified, physical demo fulfillment cannot be claimed |
| Promotions | Coupons owner | Basic coupons required for v1; owner public interface and accepted checkout/usage evidence pending (separate dedicated Coupons owner now working) |
| Bundles | Commerce / relevant owner contract | Not a blocker for this bounded native qualification; unimplemented with no bundle affordance |
| Registry pair | Commerce + Template release artifact owners | Exact qualified pre-release artifacts adopted locally; official Registry release/delivery/install proof pending |
| Blocks runtime | Template composition / EmDash public native Blocks | Current candidate uses EmDash 1.0.1 public native Blocks plus local legacy Portable Text presentation and Unknown fallbacks; no `@dinkuskit/blocks` dependency or registration. Retired pin `fe03bfac91798ac0b411b952fe23c26afefbf570` is historical style provenance only, not a shipping requirement |
| Hosted demo | Template exact working pair, isolated synthetic state | Plan only; no approved deploy or verified URL |

Current composition uses EmDash 1.0.1 public native Blocks and collection APIs
for first-class `layout` renderers. `astro.config.mjs` registers native
`dinkusCommerce()` only; it does not register `@dinkuskit/blocks`. Legacy
Portable Text uses local presentation components for retained page-hero,
fact-rail, and query-card nodes, with local Unknown fallbacks for missing
native and unsupported Portable Text. Preserve that fallback and edited
content. The retired pin `fe03bfac91798ac0b411b952fe23c26afefbf570` is
historical style provenance for copied `@layer dinkus-blocks` presentation
only. It is not an active dependency or shipping requirement. No
`@dinkuskit/blocks` owner source is changed by this correction. Remaining
Commerce public-mount/artifact, Payments transport, shipping, promotions,
registry-pair, and hosted-demo gates stay with their owners and are not
cleared here.

The current seam is concrete: `astro.config.mjs` registers native `dinkusCommerce()`,
while `src/features/commerce-catalog/index.ts` directly constructs EmDash
`PluginStorageRepository` objects under `COMMERCE_PLUGIN_ID` and imports legacy
Commerce resolvers. No registry installation, scoped plugin identity mapping,
or sandbox/public route bridge is established by this path. Replacing the pin
alone cannot prove registry compatibility. Commerce issue [#32](https://github.com/dinkuskit/commerce/issues/32)
must supply that supported guest/public mount and artifact contract.

The small integration request is a stable public shopper/admin contract for the
exact Commerce artifact: product list/detail, cart mutations, checkout start and
return/reconciliation, order/receipt read, and shipping disposition. Template
owns presentation only. Catalog proof must remain labelled catalog proof until
these gates are exercised on the same mounted pair.
