# Dual-Plane Agentic Storefront: Progressive Browser WebMCP & UCP Handoff

## Context and Clean-Room Provenance

Modern agentic storefronts separate **headless server-to-server shopping** from **in-browser co-browsing** so neither surface bloats plugin runtime bundles or exposes raw payment credentials to AI agents:

1. **Plane 1 — Headless Server UCP MCP (`/.well-known/ucp`, `/agents.md`, `/llms.txt`)**:
   - Governed by GrillTrack `ucp-timing-20261031`, `ucp-home-template-store-20261031`, `ucp-payment-handoff-20261031`, and `ucp-first-tools-20261031` (parked until after the first real v1 order ships).
   - Serves discovery manifests and JSON-RPC 2.0 MCP tools from the storefront Worker over Commerce's existing public catalog, policy, and guest checkout routes without adding bytes to `@dinkuskit/commerce`'s 128 KiB Registry bundle.
2. **Plane 2 — Progressive In-Browser Co-Browsing (`window.Dinkus.actions` + `document.modelContext` / `navigator.modelContext` WebMCP)**:
   - Implemented in `src/features/guest-cart/webmcp.ts` and installed by the cart page script (`src/features/guest-cart/cart-script.ts`).
   - Works on the same server cart the shopper's pages use: Commerce keeps the cart, the browser holds only its key in the HttpOnly `dk_cart` cookie (GrillTrack `template-cart-real-form-20261113`), and the tools call the store's Shopify-style `/cart.js` and `/cart/update.js`.
   - Registers progressively on `(document.modelContext || navigator.modelContext)?.registerTool` when a WebMCP-capable browser agent is present.

## Architectural Invariants

### 1. Storefront Cart Actions (`window.Dinkus.actions`)

Every storefront page with cart controls freezes `window.Dinkus.actions`:

- `getCart()`: Reads `/cart.js` and returns the cart's `version`, lines and Commerce integer minor-unit prices (`unitPriceMinor`, `lineSubtotalMinor`, `subtotalMinor`, `currency: "USD"`) from `/api/guest-cart/snapshot`, with a deterministic `reviewFingerprint` (`cart:<fnv1a32>:<lineCount>`) bound to the cart version, line ids, quantities, prices and sellability.
- `updateCart({ version, lines, key? })`: Replaces the whole cart, Shopify's `update_cart` shape. The caller quotes the `version` it read; omitting a line removes it. Lines are `{ id, quantity }` or `{ productId, options, quantity }` (Commerce picks the variant), `1..99` units each. A stale version changes nothing and returns `CONTENTION` with the current cart, so the agent reads again and confirms with the shopper. `key` makes a retry safe.
- `createCart(lines)`: Starts a cart only when the shopper has none (`CART_EXISTS` otherwise).
- `cancelCart({ version })`: Empties the cart.
- `showVariant({ productId, variantId? })`: Opens `/products/<id>?variant=<variant>`.
- `openCart()`: Navigates to `/cart`.
- After a successful change the header count updates and, on `/cart`, the server-drawn cart is swapped in.

### 2. Zero-Overhead Progressive WebMCP Registration

`installStorefrontWebMcp()` checks `(document.modelContext || navigator.modelContext)?.registerTool`:

- **Normal human visitors**: When neither exposes `registerTool`, it returns `{ webMcpRegistered: false, toolNames: [] }` right after attaching `window.Dinkus.actions`.
- **In-browser co-browsing agents**: Registers six tools once per context, guarded by `Symbol.for("dinkuskit.webmcp.registered")`. The names follow Shopify's agent tools.

| Tool Name | `readOnlyHint` | `consequentialHint` | `untrustedContentHint` | `idempotentHint` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `get_cart` | `true` | `false` | `true` | `true` | Returns the cart `version`, lines, quantities, `reviewFingerprint` and Commerce integer minor-unit prices (`2499` = `$24.99`). |
| `create_cart` | `false` | `false` | `true` | `false` | Starts a cart with the given lines when the shopper has none. |
| `update_cart` | `false` | `false` | `true` | `true` | Replaces the whole cart quoting `version` (required with `lines`); optional idempotency `key`. |
| `cancel_cart` | `false` | `false` | `true` | `true` | Empties the cart, quoting `version`. |
| `show_variant` | `false` | `false` | `true` | `true` | Opens a product page on a chosen variant. |
| `proceed_to_checkout` | `false` | **`true`** | `true` | `false` | Enforces the two-step `buyer_review_required` gate with explicit `reviewFingerprint` verification before navigating to `/checkout`. |

### 3. Safety Boundaries: Prompt-Injection Defense, Two-Step Buyer Review, and Hosted Payment Escalation

1. **Untrusted Content Annotation (`untrustedContentHint: true`)**:
   - Every WebMCP tool sets `annotations.untrustedContentHint = true` and `untrustedContent: true` in its response envelope so browser agent harnesses treat merchant-authored product titles and SKUs as untrusted data rather than executable agent instructions.
2. **Mandatory Two-Step `buyer_review_required` Gate Bound to Resolved Quotes**:
   - Calling `proceed_to_checkout` when the current `reviewFingerprint` has not yet been reviewed transitions state to `status: "buyer_review_required"` and returns the `reviewFingerprint` and integer minor-unit `totals` without navigating away.
   - Any cart change, from the agent, the shopper or another tab (a new cart `version`), or a Commerce price/availability change invalidates the reviewed fingerprint.
   - Only a second call that supplies **both** `buyerConfirmed: true` and the explicit matching `reviewFingerprint` succeeds, returning `status: "requires_escalation"` with `continueUrl: "/checkout"` and navigating to `/checkout`.
3. **Zero Raw Card/CVV Surface & Honest Pre-Checkout Totals**:
   - Consistent with `ucp-payment-handoff-20261031`, browser tools expose zero card number, CVV, or payment token inputs; payment always completes on the store's own checkout page (`/checkout` -> hosted Stripe or Authorize.Net).
   - Pre-checkout previews expose deterministic integer minor-unit merchandise subtotals (`subtotalMinor`) while keeping `shippingMinor`, `taxMinor`, and `totalMinor` as `null` until authoritative shipping and tax charges are resolved during checkout.
4. **Anti-DOM-Scraping Guardrail**:
   - Every validation failure and review-gate instruction explicitly directs browser agents: *"Do not attempt to update or complete the checkout by scraping or clicking page DOM controls directly. Use the registered WebMCP tools and hand off final payment to the shopper on /checkout."*
