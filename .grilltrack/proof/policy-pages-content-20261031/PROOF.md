# Policy pages are EmDash content

Covers `policy-pages-content-20261031`. Ronald, 31 Oct 2026, on the
recommendation: "What I recommend — agreed"; earlier the same day: "The page
would always show its EmDash text — I think this was my intended design." It
supersedes `structured-data-policy-feed-035`, restating its product JSON-LD
and feed parts unchanged. Commerce's side is `policy-pages-are-content-20261031`
in Commerce's ledger: Commerce keeps no policy records.

## What changed

- `/shipping` and `/returns` always render their EmDash `PortableText` body
  (`[data-policy-body]`), or an honest empty state when the page has no text.
  The Commerce facts box (`<dl data-shipping-policy>`, `<dl data-return-policy>`)
  and the policy read are gone; `src/features/commerce-policies/` and its test
  are removed.
- A published returns page with text (not a preview) carries one JSON-LD block:
  an `OnlineStore` whose `hasMerchantReturnPolicy` is a `MerchantReturnPolicy`
  given only by `merchantReturnLink`, the page's canonical URL
  (`storeReturnPolicyJsonLd` in `src/features/store-shell/structured-data.ts`).
- Product JSON-LD is built without policy input, so it never carries
  `shippingDetails` or `hasMerchantReturnPolicy`; structured terms are deferred.
- Checkout's pre-start shipping line uses the playground's flat rate in the
  playground and nothing elsewhere; Commerce prices shipping when checkout starts.
- The seeded shipping and returns copy and the `policy-support-note` section no
  longer point at a Commerce summary; they stay neutral (no rates, country codes
  or day counts).

## Proof (31 Oct 2026, Node 24.22.0, branch `claude/adoring-clarke-m3xl6u`)

| Check | Result |
| --- | --- |
| `pnpm exec vitest run` | 59 files, 535 tests passed (the removed policy reader's tests account for the drop) |
| `pnpm exec astro check` | 0 errors, 0 warnings |
| `pnpm exec playwright test tests/e2e/structured-data-policy-feed.spec.ts tests/e2e/store-header-nav.spec.ts tests/e2e/shipping-storefront-profile.spec.ts --project=chromium-desktop --project=shipping-chromium-desktop` | 5 passed: both pages show their seeded EmDash text with no unset state on the Registry proof store and the shipping store; `/returns` carries exactly the link-only `OnlineStore` block, `/shipping` none; product JSON-LD has no shipping or return terms |
| `node scripts/check-features.mjs`, `node scripts/check-worktree-text.mjs` | clean |

The phone projects run in CI.
