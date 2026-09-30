# Exact pairing and release gates

Audit date: 2026-09-30. Template base: `97d4ebfa6b31bcc00f3a3b8e72055fc4bc9e03d9`.

| Component | Current identity | Meaning |
| --- | --- | --- |
| TemplateStore | private package `0.0.0`; this candidate source | Development pilot, no approved release |
| Commerce | source `81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06` | Exact legacy native Products consumer; final owner handoff pending |
| Blocks | source `fe03bfac91798ac0b411b952fe23c26afefbf570` | Current composition dependency |
| Inventory | source `5889c7d59398376da51ac400d5c1f1214aba2c6b` | Development managed regression only; off in shipping v1 |
| EmDash | package `0.41.0` | Current tested pilot; 1.0 not yet qualified |

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
of the clean Commerce pin is
`c7b2c80c7db47e40316eebabd1e14e821bd4fa0c0648095ccabc9b3b1831f173`.
This is source provenance only, not a registry bundle or released tarball digest.

| Gate | Owner / required evidence | Current disposition |
| --- | --- | --- |
| Inventory off | Commerce disabled stock management; Template default profile | Template candidate can prove catalog boundary; final Commerce artifact pending |
| Cart / checkout / orders | Commerce public API, mounted runtime, persisted authority | Final mount and tested purchase/order path pending; no template copy of these models |
| Payment transport | Payments exact test contract and approved timing semantics | Pending; proposed provider window is not accepted by this template |
| Shipping story | Ship owner contract: fulfillment behavior and supported merchant path | Pending; physical demo fulfillment cannot be claimed |
| Promotions | Coupons owner | Stub; no promotion UI or discount-engine claim |
| Bundles | Commerce / relevant owner contract | Unimplemented; no bundle affordance |
| Registry pair | Commerce + Template release artifact owners | Pending artifact handoff and EmDash 1.0 install proof |
| Blocks runtime | Blocks owner / EmDash supported renderer contract | Native pilot remains; registry-compatible delivery or approved migration required |
| Hosted demo | Template exact working pair, isolated synthetic state | Plan only; no approved deploy or verified URL |

The Blocks graph also remains a native development dependency.
`astro.config.mjs` registers `dinkusBlocks()` alongside native Commerce; the exact
Blocks pin exports source entries, is private `0.0.0`, and peers EmDash `0.41.0`.
The first-class `layout` renderers in this template use EmDash public Blocks
and collection APIs, while legacy Portable Text still depends on Dinkus block
registration. Preserve that fallback and edited content. A registry-enabled
Blocks artifact/supported renderer path, or a separately approved migration that
removes the native requirement, must be qualified before shipping. No Blocks
owner source is changed by this audit.

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
