import { DEMO_PRODUCTS, type DemoProductSeed } from "./demo-seed-policy.js";

export const DEMO_CATALOG_PROFILES = new Set(["native-development", "demo"]);

export type DemoCatalogLink = Readonly<{
  sku: string;
  catalogItemId: string;
}>;

export type DemoProductEntry = Readonly<{
  id: string;
  slug: string;
  status: "published";
  data: {
    title: string;
    categories: string[];
    commerce_item_id: string;
    description: string;
    visual_label: string;
  };
}>;

function categoryFor(product: DemoProductSeed): string {
  if (product.variant) return "hoodies";
  if (product.sku.endsWith("CAP")) return "hats";
  return "tees";
}

function visualLabelFor(product: DemoProductSeed): string {
  if (product.variant) return "HOODIE";
  if (product.sku.endsWith("CAP")) return "CAP";
  return "TEE";
}

function entryIdFor(product: DemoProductSeed): string {
  return product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Build only the demo editorial entries. The CMS seed applies these with
 * onConflict=skip, so an existing entry is never changed or republished.
 */
export function buildDemoProductEntries(
  profile: string | undefined,
  links: readonly DemoCatalogLink[],
): DemoProductEntry[] {
  if (!profile || !DEMO_CATALOG_PROFILES.has(profile)) return [];
  const bySku = new Map(links.map((link) => [link.sku.toUpperCase(), link.catalogItemId]));
  return DEMO_PRODUCTS.flatMap((product) => {
    const commerceItemId = bySku.get(product.sku.toUpperCase());
    if (!commerceItemId) return [];
    return [{
      id: entryIdFor(product),
      slug: entryIdFor(product),
      status: "published" as const,
      data: {
        title: product.name,
        categories: [categoryFor(product)],
        commerce_item_id: commerceItemId,
        description: product.description,
        visual_label: visualLabelFor(product),
      },
    }];
  });
}
