# Matched TEST checkout composition

The opt-in server assembly consumes Commerce reviewed source
`70419ae55c4f73354e3f0eda08b09bbc85368000` and Payments reviewed source
`37842220fddb10dc5294af084110cd33804715be`. Their merge commits are separately
`ad84fe07c6dda1c493cc68a72c4f49cb6e179653` and
`1d7b5521f9986df7b7f92866b43cf7814826d607`.

`createPairedCheckoutConsumer` requires the full trusted TEST configuration,
these explicit source identities, `dinkuskit.commerce.checkout-pricing/v1`, and
a trusted shipping reader. One frozen configuration supplies the canonical
Commerce TEST payment adapter and wake client. The pricing context declares
the same schema as that adapter's resolved port. Commerce remains the sole
writer of price, frozen shipping/coupon allocations, checkout, order and
redemption state. Coupon storage is bound by Commerce from its owner context;
the host cannot supply another coupon collection. Browser input contains only
catalog identity, quantity, and an optional scalar coupon code.

The assembly delegates prepare/start/status and the named wake cron hook to
Commerce's public `@dinkuskit/commerce/features/checkout` entry. That entry
re-exports the installed handlers through `kernel/index.js`; no private module
import is needed. The canonical handlers admit the owner collections, site
origin, and guest capability before privileged operations. They must be called
with the original runtime-owned Commerce `PluginContext`. Constructing this
assembly does not prove a Registry installation or grant that authority.

## Current installed-host limit

The reviewed Registry backend creates its handlers with the default
unconfigured service resolver. EmDash 1.0.1 serializes descriptor options as
JSON, so callback-valued options do not install a trusted resolver. EmDash's existing owner settings, storage, capability-gated HTTP, and cron APIs
can support functions authored inside Commerce per invocation from the original
runtime context. The missing default service assembly belongs to Commerce;
a generic upstream callback-injection API is not established as necessary.
The current pinned artifact has no such configured assembly. A later reviewed
Commerce candidate needs explicit adoption and fresh package proof; a moving
owner checkout is never a substitute. Native aliases, fabricated contexts,
and host SQL do not qualify a Registry installation.

The default Worker and storefront do not construct this assembly or widen
public POST access. Checkout stays unavailable. Original installed context,
canonical deployed guest/callback paths, admitted egress, and one registered
site wake scheduler still require actual owner receipts before activation. A
short-lived fixture JWT does not prove account-token provisioning or renewal
for an unattended scheduler. Managed checkout also requires an Inventory-owned
authenticated reserve/release transport, which this slice does not supply.
Managed stock remains unavailable without its provider; unmanaged manual
availability and the default profile remain supported.

## Reproducing the local compiled pair

Run `pnpm verify:paired-checkout <commerce.tgz> <payments.tgz>` with the exact
owner-qualified archives. Without arguments it expects the ignored local
`commerce48.tgz` and `payments12.tgz` in `.artifacts/owner-packages/`.
The verifier requires Python 3.12+ for bounded tar admission and uses the
installed Wrangler toolchain's Miniflare/esbuild runtime. It verifies the
source pin and both archive digests, rejects unsafe archive members, extracts
packages into separate owned directories, and checks the exact Payments
Worker digest. It never imports Payments source or rebuilds that artifact.

Template's adapter is compiled locally with an external import of the immutable
compiled Commerce entry. The immutable Payments Worker executes in workerd
with its actual HTTP/JWT/SQLite logic and official Stripe SDK. All outbound
requests are intercepted: a fresh ephemeral synthetic JWKS issuer and neutral
Stripe responses are the only admitted destinations. The result contains no
JWTs, keys, guest capability values, or customer data.

Flat shipping with a non-divisible discount, free shipping, and shipping-only
payments prove frozen replay, owner-store restart, authoritative return status,
readiness regression recovery, signed webhook wake delivery, canonical
reconciliation and ACK, one durable Commerce order, and one coupon consumption.
The Commerce context/storage is explicitly an uninstalled fixture. The local
bodyless HTTP connect request is rejected by the reviewed endpoint because
Miniflare presents an empty stream; synthetic setup uses the original Payments
owner onboarding RPC. That setup does not prove public HTTP connect or live
onboarding. No real provider account/payment, deployment, Registry release,
permissions change, or activation is part of this proof. Zero final payable
orders remain a separate Commerce decision.
