# Same-template hosted demo plan

Status: WAITING_FOR_HUMAN for deployment; source/checkout readiness gates remain.
Proposed target: `demo.dinkuskit.com`. This is a suggestion, not an existing URL
or a DNS/account authorization. “Try the demo” has no verified target yet.
“Use this template” can currently point only to the public source repository
with an explicit development-pilot label, not an install-ready release.

## Candidate to deploy

Deploy the same immutable TemplateStore/Commerce pair that passes clean-install,
desktop/mobile catalog, cart, checkout and receipt/order proof. Keep Inventory off.
Use a neutral “Dinkus Demo Store” identity and synthetic products and orders.
Mark checkout “Demo checkout — no real charge or fulfillment” at entry and receipt.
Payment transport must use its approved safe test contract; no live credentials,
external sends, real charges or customer fulfillment. No provider-window proposal
is adopted here. No checkout is mounted in the current candidate.

Separate the demo database, media, payment/test identity and order state from any
merchant installation. Default shipping behavior cannot depend on demo flags or
fixture providers. Leave integration demonstrations and proof endpoints disabled;
dev authentication must be unavailable. Public visitors cannot edit admin or run
stock commands. Demo reset, if later implemented, may affect only synthetic demo
state under a separately approved narrow contract.

## Runtime and host preparation

The current runnable template uses Node server output, SQLite and local uploads.
A Node host needs a persistent database/upload volume, HTTPS, a stable public
origin and correct authentication setup; the Node guide describes server startup
and proxying. [Official Node deployment](https://docs.emdashcms.com/deployment/nodejs/).

A Cloudflare variant is the proposed registry demo route after compatibility
proof: Workers, D1 `DB`, R2 `MEDIA`, a scheduled handler, and the platform adapter.
Registry installs additionally need an available sandbox runner. Cloudflare's
runner uses `LOADER` and `PluginBridge` and requires Workers Paid; Node's runner
uses workerd. This is not an Inventory requirement.
[Cloudflare deployment](https://docs.emdashcms.com/deployment/cloudflare/),
[plugin sandbox](https://docs.emdashcms.com/deployment/plugin-sandbox/).
The current Node config cannot be deployed unchanged as that variant.

Before approval, record exact source/artifact digests, tested runtime/adapter,
account resource plan, origin/HTTPS/DNS plan and isolated demo identities without
secret values. The approved deployment scope must specify host, resources,
bindings and target URL. Configure any required secrets through approved tools;
never read or preserve values in this repository. Do not create resources, DNS,
accounts, secrets, package releases or tags from this plan.

After an approved deployment, exercise the exact hosted admin/storefront and
safe purchase/order journey on desktop and mobile, inspect visible screenshots,
confirm proof/dev routes denied and real-charge/fulfillment unavailable, then
return the verified demo URL and exact released template install target to the
website owner through the authorized coordinator handoff.
