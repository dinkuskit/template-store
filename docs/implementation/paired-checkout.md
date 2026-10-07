# Matched TEST checkout composition

This candidate consumes review-qualified Commerce49 source
`45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef` and reviewed Payments12 source
`37842220fddb10dc5294af084110cd33804715be`. Commerce49 was qualified before
merge; its immutable archives remain pre-release proof inputs. Payments12's
separate merge commit is `1d7b5521f9986df7b7f92866b43cf7814826d607`.
Exact archive and compiled backend digests are enforced by both verifiers.

Commerce remains the sole writer of prices, frozen shipping/coupon allocations,
checkout attempts, orders and redemption state. Browser input carries only
catalog identity, quantity and an optional scalar coupon code. The opt-in
`createPairedCheckoutConsumer` delegates to the public Commerce checkout entry;
its caller must supply the original runtime-owned Commerce context. Shipping
storefront and Worker defaults keep checkout unavailable.

## Default compiled runtime proof

Run `pnpm verify:registry-checkout <commerce.tgz> <registry.tar.gz> <payments.tgz>`.
With no arguments, the verifier expects `commerce49.tgz`,
`commerce49-registry.tar.gz` and `payments12.tgz` in the ignored
`.artifacts/owner-packages/` directory. Python 3.12+ admits bounded regular-file
archives; hashed copies are extracted into a new ignored proof directory. npm
and Registry backend/manifest bytes must match exactly. Payments' compiled
Worker is admitted by digest and never rebuilt or imported from source.

EmDash 1.0.1's supported `WorkerdSandboxRunner.load` executes the immutable
Commerce default backend and generates every plugin context. The local fixture
repeats the pinned host's public publisher/slug namespace derivation and manifest
ID normalization. This reproduces local loader authority without claiming signed
publisher verification, Registry delivery or an official installation. No
injected service resolver, fabricated context or replacement storage namespace
supplies the positive checkout path.

Minimal SQLite tables match the pinned SDK schema. Actual
`PluginStorageRepository` and `OptionsRepository` operations supply owner storage,
CAS and versioned settings. The credential uses the SDK's secret-setting
encryption with a fresh process-only key. Neutral catalog seeds enter through
owner repositories; only canonical Commerce operations write checkout lifecycle
state. No host SQL checkout writer is introduced.

A separately cloned **synthetic test-only** manifest grants the intercepted HTTP
bridge access to a public IP literal. Every request is routed into the immutable
Payments Worker, running its actual HTTP/JWT/SQLite Durable Object logic and
Stripe SDK. A fresh in-memory JWKS issuer and neutral Stripe responses intercept
all outbound traffic. The shipped manifest stays byte-identical with empty
grants. No fixture credentials or guest capability values appear in output.

Three scenarios cover flat shipping with a non-divisible discount, free shipping
and shipping-only payment. Each proves both owner stores restart, frozen total
and shipping replay after settings change, authoritative pending status despite
a forged browser return, signed webhook delivery, canonical order/coupon
settlement **before** exact wake ACK, repeated empty wake consumption, one
provider creation, one durable order and one coupon consumption. Unconfigured
and disabled profiles avoid credential/transport/attempt writes. Configured
missing grants retain an unconfirmed paying attempt with no transport or order;
transport denial is not a provider-not-created fence. Wrong origin, copied
configuration and invalid credential claims fail before transport.

The local bodyless HTTP connect request returns 400 because Miniflare presents
an empty stream. Synthetic setup uses the original Payments owner onboarding
RPC; public HTTP connect and live onboarding remain unproved. Invoking the named
Commerce cron hook does not register a scheduler. Actual Registry publication,
delivery/install, account-token provisioning/renewal, live egress grants,
deployed callbacks, one real scheduler and real Stripe TEST purchase remain
separate gates. Public checkout stays disabled. Zero final payable orders remain
a separate Commerce slice, as does managed Inventory reserve/release transport.

## Historical opt-in adapter proof

`pnpm verify:paired-checkout <commerce.tgz> <payments.tgz>` remains a separate
proof level against the same exact pair; defaults are `commerce49.tgz` and
`payments12.tgz`. It bundles only Template's adapter, leaving canonical Commerce
as an external immutable compiled import. Its Commerce context/storage is an
explicitly **uninstalled fixture**. Its positive Payments proof does not establish
a Registry installation or shipping activation. The default-runtime verifier
above exercises the actual EmDash context bridge and supersedes that fixture
fidelity for this adoption slice.
