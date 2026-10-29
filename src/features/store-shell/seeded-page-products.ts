/**
 * The seed's demonstration product pages, known by their slugs now that pages
 * carry no Commerce product field (template-no-commerce-box-20261029). Their
 * ids are the template's own demonstrations and previews, never real Commerce
 * products, so Commerce answers that it has no such product and each page
 * stays a preview.
 */
export const SEEDED_PAGE_PRODUCTS: Readonly<Record<string, string>> = Object.freeze({
  "everyday-tee": "dinkus-template-managed-product",
  "boxy-tee-preview": "dinkus-template-preview-boxy-tee",
  "pullover-hoodie-preview": "dinkus-template-preview-hoodie",
  "canvas-cap": "dinkus-template-unmanaged-product",
  "ribbed-beanie-preview": "dinkus-template-preview-beanie",
});
