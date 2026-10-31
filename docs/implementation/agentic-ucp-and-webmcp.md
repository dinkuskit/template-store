# Dual-Plane Agentic Storefront: Progressive Browser WebMCP & UCP Handoff

## Context and Clean-Room Provenance

Modern agentic storefronts separate **headless server-to-server shopping** from **in-browser co-browsing** so neither surface bloats plugin runtime bundles or exposes raw payment credentials to AI agents:

1. **Plane 1 — Headless Server UCP MCP (`/.well-known/ucp`, `/agents.md`, `/llms.txt`)**:
   - Governed by GrillTrack `ucp-timing-20261031`, `ucp-home-template-store-20261031`, `ucp-payment-handoff-20261031`, and `ucp-first-tools-20261031` (parked until after the first real v1 order ships).
   - Serves discovery manifests and JSON-RPC 2.0 MCP tools from the storefront Worker over Commerce's existing public catalog, policy, and guest checkout routes without adding bytes to `@dinkuskit/commerce`'s 128 KiB Registry bundle.
2. **Plane 2 — Progressive In-Browser Co-Browsing (`window.Dinkus.actions` + `document.modelContext` / `navigator.modelContext` WebMCP)**:
   - Implemented in `src/features/guest-cart/webmcp.ts` and hydrated alongside `hydrateGuestCartControls()` (`src/features/guest-cart/guest-cart-client.ts`).
   - Provides a unified client cart batcher (`window.Dinkus.actions`) and zero-overhead progressive registration on `(document.modelContext || navigator.modelContext)?.registerTool` when a WebMCP-capable browser agent is present.

## Architectural Invariants

### 1. Unified Storefront Cart Action Kernel (`window.Dinkus.actions`)

Every storefront page with guest-cart controls freezes `window.Dinkus.actions`:

- `getCart({ includeCatalog })`: Loads the browser's `dinkus.guest-cart.v1` intent and resolves authoritative integer minor-unit unit prices and line subtotals (`unitPriceMinor`, `lineSubtotalMinor`, `subtotalMinor`, `currency: "USD"`) from `/api/guest-cart/snapshot` alongside a deterministic quote `reviewFingerprint` (`cart:<fnv1a32>:<lineCount>`) bound to line IDs, quantities, resolved unit/line prices, currency, and sellability.
- `updateCart(patch)`: Accepts additive (`mode: "add"` / `"merge"`) or full-replacement (`mode: "replace"`) line updates (`1..99` units per SKU) or `clear: true`. Additive modes route through `addGuestCartLine` to increment existing line quantities up to `99` (with `quantity: 0` in `merge` mode removing the line). Full-replacement (`replace`) mirrors UCP `update_cart` semantics: the caller supplies the complete desired line list, omitting a line to remove it, and zero quantities in `replace` or `add` mode are rejected with a structured schema error rather than silently mutating state.
- Synchronization Events: Successful mutations emit `CustomEvent("dinkus:cart:updated", { detail: cart })` on `window` plus `guest-cart-updated` and `dinkus:guest-cart-hydrate` on `document`, keeping header cart badges (`[data-guest-cart-count]`), Astro islands, and `/cart` or `/checkout` views synchronized without full-page reloads. Failed mutations emit `CustomEvent("dinkus:cart:error", { detail: error })`.
- `openCart()`: Navigates to `/cart`.

### 2. Zero-Overhead Progressive WebMCP Registration

`installStorefrontWebMcp()` checks `(document.modelContext || navigator.modelContext)?.registerTool`:

- **Normal human visitors**: When neither `document.modelContext` nor `navigator.modelContext` exposes `registerTool`, `installStorefrontWebMcp()` returns `{ webMcpRegistered: false, toolNames: [] }` immediately after attaching `window.Dinkus.actions`.
- **In-browser co-browsing agents**: Registers six tools once per context, guarded by `Symbol.for("dinkuskit.webmcp.registered")`.

| Tool Name | `readOnlyHint` | `consequentialHint` | `untrustedContentHint` | `idempotentHint` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `get_cart` | `true` | `false` | `true` | `true` | Returns cart lines, quantities, `reviewFingerprint`, and authoritative Commerce integer minor-unit prices (`2499` = `$24.99`). |
| `add_to_cart` | `false` | `false` | `true` | `false` | Adds or increments a Commerce product (`id`, `quantity` `1..99`) via `window.Dinkus.actions.updateCart({ mode: "add" })`. |
| `update_cart_lines` | `false` | `false` | `true` | `true` | Full-PUT replacement of `lines` (`[{ id, quantity }]`); omitting a line removes it. |
| `cancel_cart` | `false` | `false` | `true` | `true` | Clears all guest cart lines. |
| `get_checkout_preview` | `true` | `false` | `true` | `true` | Returns integer minor-unit merchandise subtotal (`subtotalMinor`, `discountMinor`) and `reviewStatus` (`empty_cart \| buyer_review_required \| buyer_reviewed`). `shippingMinor`, `taxMinor`, and `totalMinor` remain `null` until authoritative charges are resolved on `/checkout`. |
| `proceed_to_checkout` | `false` | **`true`** | `true` | `false` | Enforces the mandatory 2-step `buyer_review_required` gate with explicit `reviewFingerprint` verification before navigating to `/checkout`. |

### 3. Safety Boundaries: Prompt-Injection Defense, Two-Step Buyer Review, and Hosted Payment Escalation

1. **Untrusted Content Annotation (`untrustedContentHint: true`)**:
   - Every WebMCP tool sets `annotations.untrustedContentHint = true` and `untrustedContent: true` in its response envelope so browser agent harnesses treat merchant-authored product titles and SKUs as untrusted data rather than executable agent instructions.
2. **Mandatory Two-Step `buyer_review_required` Gate Bound to Resolved Quotes**:
   - Calling `proceed_to_checkout` when the current `reviewFingerprint` has not yet been reviewed transitions state to `status: "buyer_review_required"` and returns the `reviewFingerprint` and integer minor-unit `totals` without navigating away.
   - Any subsequent cart mutation (`updateCart`) or authoritative Commerce price/availability change invalidates the reviewed fingerprint.
   - Only a second call that supplies **both** `buyerConfirmed: true` and the explicit matching `reviewFingerprint` succeeds, returning `status: "requires_escalation"` with `continueUrl: "/checkout"` and navigating to `/checkout`.
3. **Zero Raw Card/CVV Surface & Honest Pre-Checkout Totals**:
   - Consistent with `ucp-payment-handoff-20261031`, browser tools expose zero card number, CVV, or payment token inputs; payment always completes on the store's own checkout page (`/checkout` -> hosted Stripe or Authorize.Net).
   - Pre-checkout previews expose deterministic integer minor-unit merchandise subtotals (`subtotalMinor`) while keeping `shippingMinor`, `taxMinor`, and `totalMinor` as `null` until authoritative shipping and tax charges are resolved during checkout.
4. **Anti-DOM-Scraping Guardrail**:
   - Every validation failure and review-gate instruction explicitly directs browser agents: *"Do not attempt to update or complete the checkout by scraping or clicking page DOM controls directly. Use the registered WebMCP tools and hand off final payment to the shopper on /checkout."*
