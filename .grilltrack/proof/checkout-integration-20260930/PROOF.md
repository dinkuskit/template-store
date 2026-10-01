# Dinkus Template Store Checkout Integration Proof

Audit & Qualification Date: 2026-09-30
Repository: `https://github.com/dinkuskit/template-store`
Worktree: `/Users/bobbybones/Developer/dinkus/template-store-checkout-integration-20260930`
Branch: `codex/template-store-checkout-integration-20260930`
Base Commit: `41a63299d575eeb9784de700c63ca628543b2d60`

## Upstream Dependency Source Identifiers

- **Commerce Pin**: `ab37cd7f362f1c37cb1d321192abbbc48a623833`
  - Repository: `https://github.com/dinkuskit/commerce.git`
  - Features: Native Products & guest checkout routes (`prepare`, `start`, `status`), bounded payment window (`1800..1860s`), disabled stock management support.
- **Payments Pin (READ ONLY)**: `636f01225417fac4fc51fd88604aeb4ba96440a1`
  - Repository: `https://github.com/dinkuskit/payments.git`
  - Status: Inspected read-only; not pinned in `package.json` or imported by template.
- **Blocks Pin**: `fe03bfac91798ac0b411b952fe23c26afefbf570`
- **Inventory Pin**: `5889c7d59398376da51ac400d5c1f1214aba2c6b` (shipping v1 profile off)
- **EmDash**: `0.41.0`

## Integration Matrix Status

| Matrix Item | Status | Evidence / Notes |
| --- | --- | --- |
| **unmanaged native / profile / local stock** | PASS | Canonical parent verification passed (`tests/e2e/shipping-storefront-profile.spec.ts`, `tests/e2e/guest-checkout-feasibility.spec.ts`). Limited scope qualifies NATIVE source only. |
| **Registry disabled slider** | BLOCKED | Block Kit lacks disabled-toggle UI support (native stock management disabled profile is separate). |
| **checkout transport/wake** | BLOCKED | Requires trusted host transport, authenticated bridge, and durable internal wake consumer. |
| **Stripe** | NOT_RUN | No live or test mode Stripe network calls executed; synthetic mocks prohibited. |
| **packagedRegistry** | BLOCKED | Registry-installed bundle distribution pending; currently operating via qualified native source dependencies. |
| **nativeBlocks / EmDash 1.0 migration** | UNQUALIFIED | Blocks graph remains a native development dependency peering EmDash 0.41.0; registry-compatible delivery or approved migration required. |
| **coupons (v1 required)** | PENDING | Basic coupons required for v1; separate dedicated owner working, public interface and accepted checkout/usage evidence pending. |
| **shipping/contact/tax** | UNQUALIFIED | Owner dependencies pending; shipping story, contact, and tax owner paths unqualified for physical fulfillment. |
| **inventory / bundles** | NON_BLOCKING | Non-blocking for this bounded native qualification; shipping v1 profile operates with Inventory off and bundles are not required. |
| **full purchase (redirect, paid receipt, single order, newer intent, lost payment response, restart)** | BLOCKED | Full purchase flow blocked pending upstream payment transport and reconciliation. |

## Verified Parent Qualification Evidence

Direct native descriptor, EmDash options serialization, and native route dispatch checks were executed by the parent verifier and passed:

1. **Native Commerce Descriptor & Route Mounting** (`runs/checkout-integration-runs/20260930/parent-commerce-descriptor.log`):
   - Source: `ab37cd7f362f1c37cb1d321192abbbc48a623833`.
   - `dinkusCommerce(options)` produces pure descriptor and drops `checkout` field (`descriptorDropsCheckout: true`).
   - `createPlugin(options)` mounts all guest checkout routes (`createPluginMountsAllGuestRoutes: true`).
2. **EmDash Host Option Serialization** (`runs/checkout-integration-runs/20260930/parent-current-emdash-options.log`):
   - Host `emdash@0.41.0`.
   - Verifies string options preserved across host serialization (`paymentBindingStringPreserved: true`).
   - Verifies function options dropped upon host serialization (`resolverFunctionPreserved: false`).
   - Direct resolved plugin registration rejected by EmDash schema (`directResolvedPluginRejected: true`).
3. **Direct Native Dispatch on EmDash SQLite** (`runs/checkout-integration-runs/20260930/parent-current-native-dispatch.log`):
   - Direct native dispatch with real `PluginStorageRepository`:
   - Retained capability across connection reopen (`retainedCapabilityAcrossConnectionReopen: true`).
   - Repeat start returns fail-closed 503 `PAYMENTS_UNAVAILABLE`.
   - Missing and forged capability return 403 `CAPABILITY_DENIED`.
   - Injected cart price/cartId return 400 `INVALID_CART`.
   - Cross-origin dispatch returns 403 `ORIGIN_DENIED`.
   - Safe status returns `{ order: null, redirectUrl: null }`.
   - Capability record delta: +1; checkout carts: 0 (meaning 0 attempts and 0 embedded orders; orders collection is not the oracle).
   - Inventory configurations: 0.
4. **Payments Hosted Handler Negative Contract** (`runs/checkout-integration-runs/20260930/parent-payments-host.log`):
   - Inspected source `636f01225417fac4fc51fd88604aeb4ba96440a1`.
   - 4 hosted endpoints (`GET /v1/checkout-binding`, `GET /v1/existing-binding`, `POST /v1/checkout/session`, `POST /v1/checkout/lookup`) require server-authenticated principal with `payments:checkout` scope; all 4 return 401 unauthenticated.
   - Proposed wake drain route (`/v1/checkout/wakes`) returns 404 (no exposed wake consumer exists).
5. **Site & Origin Trust Boundaries** (`runs/checkout-integration-runs/20260930/parent-explicit-origin.log`):
   - Unconfigured site rejects prepare (`UNAVAILABLE`, 503); matching request origin cannot establish trust.
   - Wrong trusted site presenting a retained capability is rejected with `CAPABILITY_DENIED` (403).
6. **Parent Port Parity Contract** (`runs/checkout-integration-runs/20260930/parent-port-parity.log`):
   - Verified actual Commerce (`ab37cd7f362f1c37cb1d321192abbbc48a623833`) and Payments (`636f01225417fac4fc51fd88604aeb4ba96440a1`) helper parity for current bounded window (1799: false, 1800: true, 1830: true, 1860: true, 1861: false) and historical 1800 original unchanged (1800: true, others: false).
   - Source-only contract verification (`stripeNetwork`: NOT_RUN, `transport`: NOT_RUN).

## Canonical Verification Results (PASS - Limited Scope)

Canonical parent verification (`bin/verify-web full` / `corepack pnpm verify`) completed with passing test assertions under Node `22.23.2` / pnpm `11.9.0` and passed all suites:
- **Unit Tests**: 31 passed (`tests/unit/checkout-dependency-handoff.test.ts`, `tests/unit/managed-product-availability.test.ts`, `tests/unit/unmanaged-product-sellability.test.ts`).
- **Workflow Tests**: 9 passed.
- **Browser Acceptance Tests**: 20 passed across desktop Chromium and mobile viewports (`9.8m` total browser duration).
- **Astro Check**: 0 errors, 0 warnings, 0 hints.
- **Verification Log**: `runs/checkout-integration-runs/20260930/parent-verify.log` (SHA-256: `e455197a9a7a573c623d5b109babc92283fa40cba68e0394421c43aee6d45e5c`).
- **Verification Manifest**: `runs/checkout-integration-runs/20260930/parent-verification-result.json`.

### Bounded Browser Feasibility Contract (`tests/e2e/guest-checkout-feasibility.spec.ts`)

Verified across `shipping-chromium-desktop` and `shipping-chromium-mobile`:
- **Capability Preparation**: HTTP 200, session token safely retained in-page (`sessionStorage`), exact capability record delta of +1 per execution.
- **Default Denial**: Initial start returns HTTP 503 `PAYMENTS_UNAVAILABLE`; page reload retains capability and re-returns HTTP 503 `PAYMENTS_UNAVAILABLE`.
- **Denial Boundaries**:
  - Missing capability bearer: HTTP 403 `CAPABILITY_DENIED`.
  - Forged capability bearer: HTTP 403 `CAPABILITY_DENIED`.
  - Cross-origin dispatch (`sec-fetch-site` / host HTML guard may precede Commerce): HTTP 403.
  - Injected extra price (`extraMoney`): HTTP 400 `INVALID_CART`.
  - Injected extra cart field (`extraField`): HTTP 400 `INVALID_CART`.
- **Projection Safety**: Status endpoint returns HTTP 200 with `{ order: null, redirectUrl: null }`.
- **Storefront Cart Presentation**: Checkout is disabled (`browserCheckoutDisabled: true`) with reason `"Checkout is not available yet."`.
- **Forged Return Denial**: Forged return cannot confirm purchase (`forgedReturnConfirmedPurchase: false`).
- **Database Oracle Isolation**:
  - `checkoutCarts: 0` (0 checkout carts implies 0 checkout attempts and 0 embedded Commerce orders; orders collection is not the oracle).
  - `storeInventoryConfigurations: 0`.
  - Durable capability records in shared test database: desktop: 1, mobile: 2 (delta of 1 capability per project run).

### Shipping Profile Contract (`tests/e2e/shipping-storefront-profile.spec.ts`)

Verified across `shipping-chromium-desktop` and `shipping-chromium-mobile`:
- Native Products admin displays "Coming soon" beside disabled stock management (`comingSoon: true`).
- Manage Stock control is disabled in administrative panel (`manageStockDisabled: true`).
- 0 Inventory network requests executed (`inventoryRequests: 0`).
- Explicit development integration profile proves managed sequence `8 -> 5 -> 8` stock transition, while shipping v1 profile operates with Inventory off.

### Visual Inspection

Parent inspected 4 visual screenshots:
1. `runs/checkout-integration-runs/20260930/browser/shipping-chromium-desktop/guest-checkout-disabled.png` (SHA-256: `a888103c75d04a35662b1b7ab1c51cc381958acd0c3450c255813976bdb8aa4c`)
2. `runs/checkout-integration-runs/20260930/browser/shipping-chromium-mobile/guest-checkout-disabled.png` (SHA-256: `43f5723f1d3cc71ff40c73bc1c54916ebb6e34a5b72162d381418715fd6a11c1`)
3. `runs/v1-release/browser/shipping-chromium-desktop/admin-products.png` (SHA-256: `ef8b6b1e8570d42218d6172d341cefdb066ec05975808b9fb3a75d0f60abb360`)
4. `runs/v1-release/browser/shipping-chromium-mobile/admin-products.png` (SHA-256: `ec1549ab0113cd41ae3c825c5af03b8438fa2c4aa83ed926ddc4cfcef725b550`)

Parent visual inspection confirmed desktop and mobile cart disabled checkout presentation and native Products disabled "Coming soon" stock control are properly rendered.

### Material Log Limitations

The verification run noted three material log items:
1. **Build Chunk-Size Warning**: Vite build emitted `(!) Some chunks are larger than 500 kB after minification.`
2. **BlockCard React Key Errors**: Vite console emitted React key warning: `Each child in a list should have a unique "key" prop. Check the render method of div. It was passed a child from BlockCard.`
3. **InlinePortableTextEditor SSR Error**: SSR composition emitted an invalid hook call and `TypeError: Cannot read properties of null (reading 'useSyncExternalStore')` originating in `@tiptap/react` / `InlinePortableTextEditor.tsx` during CMS composition despite functional assertions passing. Root cause is NOT established; this is a deferred host/editor compatibility investigation. No blanket clean-console, renderer, EmDash 1.0, or general readiness claims are made. The renderer is not repaired in this slice.

### Scope and Boundary Qualification

- **NATIVE Source Only**: This qualification applies exclusively to the qualified NATIVE development source integration (`@dinkuskit/commerce` source alias). No source or alias digest release claims are made.
- **Blocked Upstream Capabilities**: Checkout bridge transport and wake consumer, Registry disabled slider, Registry release artifact, full purchase flow (provider redirect, paid receipt, single paid order, newer intent, lost payment response, restart) remain **BLOCKED**.
- **Stripe**: **NOT_RUN**; no live or test mode Stripe calls were made.
- **Native Blocks / EmDash 1.0 Migration**: **UNQUALIFIED**; Blocks graph remains a native development dependency.
- **Coupons**: **PENDING**; required for v1, awaiting separate owner's public interface and accepted checkout/usage evidence.
