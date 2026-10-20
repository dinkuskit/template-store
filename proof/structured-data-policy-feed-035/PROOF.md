# Issue 35 proof

Commerce pin `cbc636eab20ee7759107f3a10ddff776cebe7dd8`. Native-development
proof uses the local public Commerce routes. It does not claim a Registry
install, a deployment, or a Google or Meta account connection.

## Commands

- `pnpm exec vitest run` on the catalog, feed, policy, boundary, and JSON-LD
  units: 62 passed. Log: `runs/issue35-runs/repair-unit.log`.
- `node --test tests/workflows/verify-site-crawl.test.mjs`: 6 passed,
  including a commerce-linked page with no Product script and a missing feed.
  Log: `runs/issue35-runs/repair-verify-site-crawl.log`.
- Playwright `tests/e2e/product-pages.spec.ts` and
  `tests/e2e/structured-data-policy-feed.spec.ts` on `chromium-desktop` and
  `chromium-mobile`: 4 passed. Log:
  `runs/issue35-runs/repair-playwright-proof-2.log`.
- Playwright `tests/e2e/shipping-storefront-profile.spec.ts` on
  `shipping-chromium-desktop` and `shipping-chromium-mobile`: 2 passed. Log:
  `runs/issue35-runs/repair-playwright-shipping.log`.
- `pnpm verify` (`bin/verify-web full`): exit 0. Astro check 0 errors, vitest
  355 passed, workflow tests 72 passed, 0 failed, and 2 skipped, Playwright 63 passed
  and 9 skipped, preview `verify-site` on port 4640 passed. Log:
  `runs/issue35-runs/repair-pnpm-verify-2.log`.

## What the browser proof showed

On the native-development server, `/products/demo-shirt` has one Product
JSON-LD block. Its `url` and `offers.url` match `link rel=canonical`. The
visible name, SKU `DEMO-HOSTED-SHIRT`, `$32.00`, and in-stock status match
`buildProductJsonLd`. `/products/demo-hoodie` starts at `$56.00` in the script
and stays there after the visible Medium price becomes `$60.00`. A GTIN set on
the shirt appears on that page and in the Google feed; the cap has none.
A description containing `</script><script>alert(1)</script>` stays inside one
JSON-LD script. Two authenticated shipping and return edits move the EmDash
pages and the product script together. The shirt is only in the Google feed,
the cap only in the Meta feed, and the mug in neither. Feed links are the
product canonical URLs. Trailing-slash feed URLs are not a second 200.

On the shipping server, `/products/boxy-tee-preview` and the everyday tee 503
have no Product script and no invented SKU or price. Shipping and returns say
the policy is not configured. Both feeds return 503 and do not name
`boxy-tee`.

The built preview origin has 3 editorial product pages and 0 commerce-linked
pages. Its feeds fail closed at 503. That absence of a linked catalog is not
treated as a product-page failure.

## Limits

An editorial page with no resolved public Commerce SKU does not get a Product
block. The pinned builder requires `product.sku`, and this template does not
invent one. Managed and unmanaged demonstration pages stay without JSON-LD.

`catalog/public` at this pin does not project `feedChannels`. Native
development joins `loadProductFeedEligibility`. A registry or shipping profile
does not open that storage, so it cannot populate channel feeds until the
public catalog projects eligibility.
