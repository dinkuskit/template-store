# Demo refresh deployment plan

Status: planning only. This document does not authorize deployment, provider
traffic, production writes, admin exposure, or Access/configuration changes.

The live demo was observed on 2026-10-09 at `https://demo.dinkuskit.com`.
That observation showed three synthetic products, legacy `/shop/id` URLs, an
honest purchases/checkout-unavailable banner, and no visible live revision
marker. The current live revision is therefore unknown. Existing main-branch
deployment notes that disagree with those observations are historical until
reconciled against a fresh read-only inspection.

## 1. Qualify the installed artifact

1. Build the exact source revision with Node `22.23.2` and frozen lockfile
   dependencies.
2. Require the Commerce owner's immutable artifact identity and digest matching
   the TemplateStore dependency contract. A source alias, native local mount,
   or proof adapter is not release evidence.
3. Confirm the shipping profile consumes only the installed Commerce public
   catalog route, with Inventory configuration/network, native plugin mounts,
   and local proof adapters absent.
4. Confirm absent, private, or malformed installed catalog data fails closed
   without seeded or synthetic catalog fallback.
5. Record the artifact identity, digest, route evidence, and exact verification
   output before any preview request.

## 2. Prepare protected content/media separately

1. Back up the current CMS-owned composition and published content through the
   approved EmDash content workflow.
2. Draft any copy or projected media changes in a protected, reviewable
   environment. Do not seed catalog products, replace CMS media with fake
   photos, or overwrite populated page layout.
3. Review the draft as an authenticated editor and anonymous shopper, including
   media alt text, missing-media `No image`, prices, availability, cart actions,
   and closed checkout.
4. Keep this content/media draft approval separate from the code build and
   deployment approval.

## 3. Build, preview, approve

1. Run the full project verification and capture desktop Chromium and mobile
   viewport proof from the native-development profile locally only.
2. Run the read-only site verifier against the preview origin, including
   canonical routes, redirects, noindex behavior, robots, sitemap, and nested
   links.
3. Have the owner approve the preview screenshots, assertion record, exact
   Commerce artifact pair, and CMS-preservation diff.
4. Approve deployment only through the separately authorized Cloudflare
   workflow targeting `dinkuskit-template-demo` and its configured D1/R2
   resources. No Access rule or permission change belongs in this refresh.

## 4. Rollback

If the preview or post-deployment read-only checks fail, restore the last
owner-approved immutable application revision and the separately approved CMS
content/media snapshot. Re-run the installed public catalog and closed-cart
checks before reopening the demo. Do not restore by introducing a native mount,
fixture, seeded fallback, checkout activation, or provider traffic.

The rollback target is currently unknown until the live revision is identified
through an authorized read-only deployment inspection.

## Reviewable cutover packet

The code candidate starts from TemplateStore main
`50e7ec686db119e43a8b3921cd94f5227903160d`. It preserves the exact Commerce
source pin `00e3544b5de88f952f319e5f9561996826171e54` and EmDash `1.2.0`.
Record the final PR head and built artifact SHA-256 at handoff. Pin updates
require their own compatibility evidence; this refresh changes no pin.

Safe local checks for that head:

```sh
node -v # must print v22.23.2
pnpm install --frozen-lockfile
pnpm verify
./scripts/grilltrack --project . validate
```

Before requesting a production cutover, the authorized deployment owner must
supply the current Worker version/deployment identity and exact installed
Commerce identity/digest from read-only deployment/installation records. Keep
account/database identifiers and production configuration out of Git. Inspect
whether the live native pilot can be migrated through the supported installed
plugin contract without changing catalog storage identity; stop if that
identity is not proven. The existing three `DEMO-HOSTED-*` products must survive
that qualification. Do not run the reset/seeder on the live CMS.

Build the Cloudflare candidate into a fresh owned output location using the
existing Cloudflare hosting profile and a reviewed operator-materialized
configuration. No deployment command is approved by this document. Preview the
same built artifact and actual installed plugin pair against isolated synthetic
state, with proof/development routes disabled and admin protected. Record the
preview URL, Worker build digest and install receipts, then run:

```sh
bin/verify-site <reviewed-preview-origin>
```

The current live baseline fails `/home` redirection and `/sitemap.xml`
availability. Both checks must pass on the preview and after cutover. Smoke-test
home, actual canonical product/category URLs, cart add/update/remove/reload,
unavailable checkout, noindex, protected admin, and denied proof/setup paths on
desktop and mobile. Reviewer approval must name the exact artifact, target
Worker, unchanged resources/Access policy, preserved CMS data and rollback
version. A successful source CI or local native fixture is insufficient.

After explicit merge/deploy approval, the deployment owner promotes only the
reviewed artifact and runs the same public checks against
`https://demo.dinkuskit.com`. Rollback means reactivating the recorded previous
Worker version through the owner's approved Cloudflare process. Code-only
cutover should not require restoring CMS data; restore a reviewed CMS snapshot
only if a separately approved content migration changed it. Do not blindly
reseed or overwrite later editorial changes. Keep checkout unavailable throughout.

### Profile gate for the Cloudflare candidate

The committed Wrangler template currently names the proof storefront profile.
It is not a deploy-ready shipping configuration. The deployment owner must
review an explicit shipping profile, disabled proof mode and disabled payments,
with no `native-development` catalog registration, before preview qualification.
The local compilation used the shipping profile and an ignored local D1
configuration; it proves compilation only. It does not establish remote D1/R2,
Registry installation, route activation or content migration readiness.
