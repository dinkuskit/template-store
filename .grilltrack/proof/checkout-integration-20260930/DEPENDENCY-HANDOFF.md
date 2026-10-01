# Dinkus Template Store Upstream Dependency Handoff

Audit & Qualification Date: 2026-09-30
Repository: `https://github.com/dinkuskit/template-store`
Worktree: `/Users/bobbybones/Developer/dinkus/template-store-checkout-integration-20260930`
Branch: `codex/template-store-checkout-integration-20260930`
Base Commit: `41a63299d575eeb9784de700c63ca628543b2d60`

## Upstream Pin Specifications

### 1. Commerce
- **Commit**: `ab37cd7f362f1c37cb1d321192abbbc48a623833`
- **Repository**: `https://github.com/dinkuskit/commerce.git`
- **Exported Contracts Consumed**:
  - `CURRENT_PAYMENT_WINDOW` ({ minSeconds: 1800, maxSeconds: 1860 })
  - `createCurrentPaymentRequest`
  - `isCurrentPaymentRequest`, `isLegacyExact1800PaymentRequest`
  - `paymentRequestHandoff`
  - `providerSessionWindowIsValid`
  - `readFrozenPaymentWindowBounds`
  - `COMMERCE_PLUGIN_ID` (`dinkus-commerce`)
  - `GUEST_CHECKOUT_PREPARE_ROUTE`, `GUEST_CHECKOUT_START_ROUTE`, `GUEST_CHECKOUT_STATUS_ROUTE`
  - `CHECKOUT_COLLECTION` (`checkoutCarts`), `CHECKOUT_GUEST_CAPABILITY_COLLECTION` (`checkoutGuestCapabilities`)
  - `CHECKOUT_SANDBOX_COLLECTION` (`checkout_carts`), `CHECKOUT_GUEST_CAPABILITY_SANDBOX_COLLECTION` (`checkout_guest_capabilities`)
  - `GUEST_CAPABILITY_HEADER` (`x-commerce-guest-capability`), `GUEST_ORIGIN_HEADER` (`origin`), `GUEST_SEC_FETCH_SITE_HEADER` (`sec-fetch-site`)
  - `GuestCheckoutError`
  - `CheckoutPaymentPort`, `GuestCheckoutHostOptions`, `PaymentRequest`, `PaymentOutcome`, `CheckoutExecution`, `CheckoutAttempt`, `GuestCapabilityRecord`
  - `dinkusCommerce`, `createPlugin`

### 2. Payments (READ ONLY)
- **Commit**: `636f01225417fac4fc51fd88604aeb4ba96440a1`
- **Repository**: `https://github.com/dinkuskit/payments.git`
- **Status**: Inspected READ ONLY; NOT installed or pinned as a TemplateStore package dependency.

---

## Typed Payment Port and Host Contract

The typed contract between Commerce and upstream Payments is defined by actual Commerce public types from `@dinkuskit/commerce`:

```ts
import type {
  CheckoutPaymentPort,
  GuestCheckoutHostOptions,
  PaymentRequest,
  PaymentOutcome,
  CheckoutExecution,
} from "@dinkuskit/commerce";

type ServerPaymentResolver = NonNullable<GuestCheckoutHostOptions["resolvePayments"]>;
type EnsureSession = CheckoutPaymentPort["ensureSession"];
type Lookup = CheckoutPaymentPort["lookup"];
```

Exact `CheckoutPaymentPort` interface methods:
- `ensureSession(request: PaymentRequest): Promise<PaymentOutcome>`: Persist the original claim/request/deadline/idempotency key before provider contact; replay that exact tuple without resetting deadlines, altering parameters, sending new keys, or lookup-create.
- `lookup(request: PaymentRequest): Promise<PaymentOutcome>`: Authoritative outcome lookup. Events are hints only. `not-created` serves as a terminal creation fence.

Host configuration requires server-owned:
- `siteUrl?: string`: Host-owned trusted public site origin. Used when runtime `ctx.site.url` is empty; present public, malformed, or conflicting runtime URL cannot be masked. Not read from Host, query, or body.
- `paymentBindingRef?: string`: Merchant/provider binding reference.
- `resolvePayments?: CheckoutExecution["resolvePayments"]`: Server-owned resolver with existing `CheckoutExecution` resolver type (`(bindingRef: string) => Promise<CheckoutPaymentPort | null>`).

---

## Plugin Descriptor Seam and Option Handling

There is a critical architectural seam between static plugin registration and runtime route execution:

1. **dinkusCommerce Option Stripping**:
   - `dinkusCommerce` produces an EmDash plugin descriptor.
   - It accepts local development options (`enableLocalStockManagement`, `siteUrl`) and **drops the `checkout` field** entirely.
   - It does NOT mount routes itself.
2. **EmDash Host JSON Serialization**:
   - EmDash host configuration serializes plugin options to JSON when passing them across subsystem boundaries.
   - This serialization drops function properties, such as `resolvePayments`.
3. **createPlugin Runtime Mounting**:
   - `createPlugin` accepts runtime options including `checkout.resolvePayments`.
   - It mounts the guest checkout routes (`checkout/guest/prepare`, `checkout/guest/start`, `checkout/guest/status`) and initializes plugin storage repositories.
   - When running in native EmDash without an in-process host bridge supplying `resolvePayments`, guest checkout routes start fail-closed with HTTP 503 `PAYMENTS_UNAVAILABLE`.
   - Route mounting registers route endpoints, but does NOT equate to an operational Payments bridge.

---

## Token Storage and Capability Separation

- **Presentation Bearer Token**: The bearer token `{capabilityId}.{secret}` is handled with strict boundary separation. In browser testing fixtures, the bearer token is retained only in-page (e.g. test-only in-page `sessionStorage`). Direct native parent tests hold a temporary local bearer in memory only, and never write it to logs or artifacts. Production browser consumer remains blocked. Universal runtime contract must not claim exclusive browser storage.
- **Durable Capability Record**: The SQLite table (`_plugin_storage` under collection `checkoutGuestCapabilities` / sandbox `checkout_guest_capabilities`) stores actual `GuestCapabilityRecord`:
  ```ts
  interface GuestCapabilityRecord {
    recordKind: "guest-checkout-capability";
    capabilityId: string;
    cartId: string;
    verifier: string;
    siteBinding: string;
    createdAt: string;
  }
  ```
  The presentation bearer secret is authenticated by hash verification against `verifier`. No `siteId`, `expiresAt`, or numeric timestamps exist on this record.
- **Cart State and Atomic CAS**: Checkout attempt states are stored in `checkoutCarts` (sandbox `checkout_carts`). Checkout attempts transition across actual `CheckoutAttempt` phases:
  ```ts
  phase: "reserving" | "paying" | "releasing" | "released" | "paid";
  ```
  Transitions use atomic Compare-And-Set (`compareAndSet`). `checkoutCarts: 0` implies 0 checkout attempts and 0 embedded Commerce orders.

---

## Payments Principal, Hosted Endpoints, and Existing-Binding Regression

Payments (`636f01225417fac4fc51fd88604aeb4ba96440a1`) defines:
```ts
export interface Principal {
  accountId: string;
  siteId: string;
}
```

Payments provides **4 existing hosted endpoints**, all requiring an authenticated server principal with `payments:checkout` scope and site binding:
1. `GET /v1/checkout-binding?bindingRef=...` — verifies merchant readiness.
2. `GET /v1/existing-binding?bindingRef=...` — retains the frozen original recipient and binding even if merchant readiness subsequently regresses (existing-binding readiness regression only; disconnect or delete-binding behaviors are not tested or implemented).
3. `POST /v1/checkout/session` — generates provider checkout session with approved `1800..1860s` window.
4. `POST /v1/checkout/lookup` — authoritative session outcome lookup.

All 4 endpoints reject unauthenticated requests with HTTP 401 (verified in `runs/checkout-integration-runs/20260930/parent-payments-host.log`).

---

## Provider Webhook ACK vs Internal Wake ACK Distinction

A strict architectural distinction must be maintained between the payment provider webhook and internal wake consumption:

1. **Provider Webhook Acknowledgement (Payments Side)**:
   - Payments receives the provider webhook (e.g. Stripe `checkout.session.completed`).
   - Payments authenticates the signature, verifies/retrieves the session, matches the attempt, and durably records the event into `checkout_wakes` (`CREATE TABLE IF NOT EXISTS checkout_wakes (attempt_id TEXT PRIMARY KEY, woke_at INTEGER NOT NULL)`).
   - Provider webhook ACK can follow verified durable wake enqueue independent of Commerce (Payments may immediately acknowledge the provider webhook with HTTP 200).
   - Do NOT change the provider HTTP 200 response to wait on Commerce or have Payments invent its own second-order order writer.
2. **Missing Internal Wake Consumer (Commerce Reconciliation)**:
   - The missing upstream component is an internal wake consumer that needs trusted site/binding/attempt->cart routing.
   - It then calls EXISTING `reconcileCheckout(execution, cartId, attemptId)`, using the stored original request (`payment: PaymentRequest`). Payments is not a second-order writer; Commerce owns order construction and reconciliation.
   - The internal wake is acknowledged and removed only after successful reconciliation; an unresolved lookup retains durable retry.
   - Currently, inspection of Payments source confirms no wake drain route exists (`/v1/checkout/wakes` returns 404). Owner action for bridge / auth / host injection + wake consumer exposure is a precise future handoff requirement; no implementation claims are made by the template.

---

## Native vs Sandboxed Storage, Security Headers, and Immutable Registry Gate

- **Storage Names and Identities**:
  - Native plugin identifier: `dinkus-commerce` (`COMMERCE_PLUGIN_ID`).
  - Collections: native camelCase `checkoutCarts` (`CHECKOUT_COLLECTION`) and `checkoutGuestCapabilities` (`CHECKOUT_GUEST_CAPABILITY_COLLECTION`) vs sandbox snake_case `checkout_carts` (`CHECKOUT_SANDBOX_COLLECTION`) and `checkout_guest_capabilities` (`CHECKOUT_GUEST_CAPABILITY_SANDBOX_COLLECTION`).
  - Native EmDash stores collections in `_plugin_storage` with primary key `(plugin_id, collection, id)`.
  - Supported artifact must prove SAME installed plugin ID, storage, and routes.
- **Security Headers & Origin Binding**:
  - Declared headers: `x-commerce-guest-capability`, `origin`, `sec-fetch-site`. Guest declared headers must be preserved across reverse proxy and host boundaries.
  - Same-origin trust: Request origin and resolved trusted site origin must match. Neither request URL nor a matching request Origin can supply trust if there is no trusted runtime ctx.site.url OR explicit host origin (returns `UNAVAILABLE` 503). Retained capabilities presented across mismatched sites return `CAPABILITY_DENIED` (403).
- **Manifest Interop & Immutable Registry Artifact Gate**:
  - Manifest inspection (package / public plugin manifest `emdash-plugin.jsonc` only): current source manifest defines `capabilities: []` and `allowedHosts: []`, which denies interop out-of-the-box.
  - Supported artifact must permit trusted serverPayments transport via approved manifest capabilities / `allowedHosts` host support without guessed endpoints or credential configuration.
  - TemplateStore candidate source uses local source alias `.artifacts/source-deps/commerce` for testing.
  - Final pairing remains **PENDING an immutable release artifact** from the EmDash plugin registry with verified checksum, manifest, and clean install/upgrade validation.

---

## Classification of Verification Evidence

Unit tests do NOT cover all handoff contracts. Evidence is classified accurately across tiers:

1. **Unit Contract Tests** (`tests/unit/checkout-dependency-handoff.test.ts`):
   - Approved payment window range (`1800..1860s`, `CURRENT_PAYMENT_WINDOW`).
   - Legacy exact 1800s request distinction without blanket rejection.
   - Provider session window boundary validation.
   - Declared guest routes, collections, and security header constants.
   - Error status code mappings (503, 403, 400).
   - Type seam demonstrating `dinkusCommerce` drops `checkout` option while `createPlugin` mounts routes.
2. **Parent Native & Host Execution Logs** (`runs/checkout-integration-runs/20260930/parent-*.log`):
   - `parent-commerce-descriptor.log`: verifies descriptor drops checkout options and `createPlugin` mounts guest routes.
   - `parent-current-emdash-options.log`: verifies EmDash 0.41.0 host drops function options upon serialization while preserving strings.
   - `parent-current-native-dispatch.log`: direct native dispatch on real EmDash SQLite (`PluginStorageRepository`), verifying retained capability across reopen, repeat start 503, capability delta +1, 0 checkout carts / 0 embedded orders.
   - `parent-payments-host.log`: verified Payments 4 hosted endpoints return 401 unauthenticated with `payments:checkout` scope requirement, and wake drain route returns 404.
   - `parent-explicit-origin.log`: verifies unconfigured site rejects prepare (`UNAVAILABLE`), matching origin cannot establish trust, wrong site with retained capability returns `CAPABILITY_DENIED`.
   - `parent-port-parity.log`: verified actual Commerce (`ab37cd7f362f1c37cb1d321192abbbc48a623833`) and Payments (`636f01225417fac4fc51fd88604aeb4ba96440a1`) helper parity for current bounded window (1799: false, 1800: true, 1830: true, 1860: true, 1861: false) and historical 1800 original unchanged (1800: true, others: false), source-only not provider (Stripe network: NOT_RUN, transport: NOT_RUN).
3. **Browser Shipping & Feasibility Tests** (`tests/e2e/guest-checkout-feasibility.spec.ts` and `tests/e2e/shipping-storefront-profile.spec.ts`):
   - **PASS (Limited Scope)** in canonical parent verification (`bin/verify-web full` / `corepack pnpm verify`) under Node `22.23.2` / pnpm `11.9.0` (all 31 unit, 9 workflow, 20 browser in `9.8m`; astro check 0 errors/warnings/hints).
   - Output assertions (`runs/checkout-integration-runs/20260930/browser/{shipping-chromium-desktop,shipping-chromium-mobile}/assertions.json`):
     - Prepare returns HTTP 200, capability delta +1 per run.
     - Default denial: initial start HTTP 503 `PAYMENTS_UNAVAILABLE`, reload retains capability and re-returns HTTP 503 `PAYMENTS_UNAVAILABLE`.
     - Denial boundaries: missing capability 403, forged capability 403, cross-origin 403 (`sec-fetch-site` / host HTML guard may precede Commerce), extra price 400 (`extraMoney`), extra cart fields 400 (`extraField`).
     - Status 200 with null order and null redirect URL.
     - Storefront presentation: checkout disabled (`browserCheckoutDisabled: true`) with reason `"Checkout is not available yet."`.
     - Forged return cannot confirm purchase (`forgedReturnConfirmedPurchase: false`).
     - SQLite isolation: `checkoutCarts: 0` (0 checkout carts implies 0 attempts or embedded orders), `storeInventoryConfigurations: 0`, total capability records: desktop 1, mobile 2 (shared test DB).
   - Shipping admin profile actuals (`runs/v1-release/browser/{shipping-chromium-desktop,shipping-chromium-mobile}/assertions.json`):
     - Shipping "Coming soon" visible (`comingSoon: true`).
     - Manage Stock disabled (`manageStockDisabled: true`).
     - 0 Inventory network requests (`inventoryRequests: 0`).
     - Explicit proof stock transition: `8 -> 5 -> 8` managed sequence in development integration profile.
   - Visual inspection: parent inspected 4 screenshots (desktop/mobile disabled checkout and native Products disabled Coming soon stock control):
     - `runs/checkout-integration-runs/20260930/browser/shipping-chromium-desktop/guest-checkout-disabled.png`
     - `runs/checkout-integration-runs/20260930/browser/shipping-chromium-mobile/guest-checkout-disabled.png`
     - `runs/v1-release/browser/shipping-chromium-desktop/admin-products.png`
     - `runs/v1-release/browser/shipping-chromium-mobile/admin-products.png`
   - Material log limitations:
     - Vite build chunk > 500k warning (`(!) Some chunks are larger than 500 kB after minification`).
     - BlockCard React key console errors (`Each child in a list should have a unique "key" prop`).
     - InlinePortableTextEditor invalid hook call + null `useSyncExternalStore` SSR error during CMS composition (`TypeError: Cannot read properties of null (reading 'useSyncExternalStore')`) despite functional tests passing. Root cause NOT established; deferred host/editor compatibility investigation. No blanket clean-console, renderer, EmDash 1.0, or general readiness claims; renderer not repaired in this slice.
   - Qualification scope: Qualifies NATIVE source only; no source/alias digest releases claim.
   - Upstream gates: checkout bridge/wake + Registry disabled-slider / artifact / full purchase / restart / newer-intent / lost PAYMENT response BLOCKED, actual Stripe NOT_RUN, native Blocks EmDash 1.0 migration UNQUALIFIED, coupons owner required v1 interface PENDING.
4. **Stripe Test Mode**:
   - `NOT_RUN` (no synthetic mocks or network calls).
5. **Full Purchase Contracts**:
   - `redirect`, `paid`, `receipt`, `singlePaidOrder`, `lostPaymentResponse`, `restart` are explicitly **BLOCKED**.
