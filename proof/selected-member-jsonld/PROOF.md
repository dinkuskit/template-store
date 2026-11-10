# Selected-member structured data

Observed on Backroad Bum: selecting the tee's L/XL used that member's price and availability but M's SKU. This addresses template-store #213 without guessing a member SKU or changing the visible parent SKU policy from PR #146. Commerce PR #260 proposes the missing public member fact; the template's exact Commerce 0.8.0 pin stays unchanged.

| Requirement / source | Populated case | Refusal / compatibility | Evidence |
| --- | --- | --- | --- |
| #213: selected Offer must not identify a sibling | M/L/XL distinct public SKUs and XL sold out; selected SKU, price and availability agree | Missing/malformed member SKU retains preview Product facts without SKU/Offer, including when member ID equals default | `linked-product-jsonld.test.ts`, 13 tests |
| Commerce public catalog owns identifiers | List/detail parsing preserves each member's own exact optional SKU | Null, number, object, blank, oversized and absent SKU cannot borrow parent identifiers; purchasing facts stay available | Same tests; installed catalog tests |
| Existing simple-product contract | Simple SKU/GTIN/MPN/brand/Offer unchanged | Variant GTIN/MPN omitted because no member projection owns them | Same tests |
| #213 browser acceptance | Default, changed price, nondefault and sold-out selections; canonical and one Product block retained | Sold-out Add disabled; old projection has no selected Offer; selection reset restores default | `product-pages.spec.ts`, desktop + Pixel 7 |
| Site verifier supports this contract | Distinct selected member SKU or older preview accepted | Simple SKU mismatch and variant Offer without SKU rejected | `verify-site-crawl.test.mjs` |

## Observed checks

Node 24.22.0, EmDash 1.4.0, local SQLite and actual sandbox workerd Registry bundles:
- `bin/verify-web quick`: Astro 294 files, zero errors/warnings (two inherited hints); 591 unit tests; 118 workflow tests pass, two existing skips; feature/text/diff audits pass.
- Targeted `product-pages.spec.ts`: desktop and phone pass with pinned Commerce 0.8.0 (35f80f218776dac5e7954ed3740b201c086a2d20), proving older-payload fallback. Browser assertions use the anonymous public item response, not visible parent SKU or intercepted responses.
- Same targeted tests with `DINKUS_PAIRED_COMMERCE_DIR` pointing to Commerce PR260 at 73d852316f9982b06d89b2fa0e5bb4292bd12015: phone passes; desktop passes on isolated rerun after a cold-seed resource failure. This is paired source development proof, not a released Registry artifact. Candidate backend 129357 bytes, under 131072-byte Registry limit (owning PR260 checks).
- `pnpm build:registry` passes with the repository's dummy CI resource settings, no credentials, provisioning or deployment. This builds a Registry store with no Commerce mounted, as required. No plugin code or package pin changed here.

The unrelated full admin/browser matrix is left to CI; unchanged upstream already times out on this 1-vCPU/2-GB host (Backroad Bum baseline evidence, November 10). Initial too-small heap checks and cold-seed retries are test-host limitations, not store incidents. No payment, order, label, CMS mutation, indexing eligibility or hosted readiness is established by these checks.

## Scope

Cart SKU policy, picker design, visible parent SKU/GTIN/MPN lines, feeds, checkout and plugin connection/grant behavior are unchanged. An older projection deliberately loses the variant Offer rather than asserting an incorrect identity. A future signed Commerce release carrying member SKU enables the richer metadata without a template fallback to CMS or inferred labels.
