# Installed catalog consumer owner handoff — 2026-10-07

Task: Template Store installed catalog and checkout journey, single Template writer.
Baseline: Template `0040061283f748b00d23a33a17b421ec01ba7e6f`.
Commerce main revalidated: `5ade2bd0e4480b8ec9220c7872d7445e35547a3e`.
EmDash runtime dependencies: exact `1.2.0`.

Installed catalog is dispatched via EmDash `handlePublicPluginApiRoute` using the original installed plugin context, exact Registry runtime identity `r_gshdrqaldna3r7sn`, `GET catalog/public`. Cursor pages include empty filtered pages. Display price is the authoritative projected customer price. Native catalog reads and registration require the explicit `native-development` catalog profile.

Checkout remains closed in middleware and rendered cart. Template's existing admission requires `pluginId`, `sameCatalogNamespace: true`, and `checkoutConfiguration: "supported"`. Core's public catalog docs explicitly disclaim readiness. Prepare intentionally works with an unconfigured host. The exact Core service resolver checks versioned installed configuration, credential scope/site/issuer/audience/expiry, and runtime HTTP capability inside the original context, but exposes no host-facing readiness result. A supported owner contract that attests actual current installed configuration/service readiness is required before Template can admit the checkout UI and routes. Do not copy private settings or construct authority from metadata/catalog success.

Available public installed endpoints: `catalog/public` GET and `checkout/guest/prepare`, `checkout/guest/start`, `checkout/guest/status` POST. Optional coupon intent is wired to the existing canonical start client; input stays disabled with checkout. Unknown, delayed and forged-return recovery uses the existing canonical protocol; no URL-paid inference was added.

ACP delegation skill was read. The exposed tool catalog has no Cursor, Grok or Antigravity ACP lane, readiness, delegate, status or result tool and no deferred tool-search tool. Direct implementation was used; no worker ACP model, job, authentication/configuration change or installation occurred.

Existing Commerce49/Payments12 package fixtures retain their exact historical artifact identities and refuse the changed current source pairing. This candidate does not claim fresh installed artifact purchase proof, hosted identity, signed Registry delivery or real Stripe readiness. Canonical full verification and independent candidate review will be recorded separately.
