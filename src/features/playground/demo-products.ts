/**
 * Published EmDash `products` entries for the synthetic demo catalog
 * (playground and the demo profile only). Each entry links one seeded Commerce
 * item to a `/products/<slug>` page. Real stores never call this.
 */
import { DEMO_PRODUCTS, type DemoProductSeed } from "../../../scripts/demo-seed-policy.js";

export type DemoCatalogLink = Readonly<{ sku: string; catalogItemId: string }>;

/** "DEMO-HOSTED-HOODIE-S" -> "hoodie". */
export function demoProductKind(product: Pick<DemoProductSeed, "sku" | "variant">): string {
  const kind = product.sku.replace(/^DEMO-HOSTED-/u, "").toLowerCase();
  return product.variant ? kind.replace(/-[a-z]+$/u, "") : kind;
}

const VISUAL: Record<string, string> = { shirt: "TEE", cap: "CAP", hoodie: "HOODIE" };

/**
 * Local placeholder image for a seeded demo product, or null otherwise.
 * The SKU alone is not proof: the product must also be linked to the seeded
 * `demo-<kind>` EmDash entry, so a merchant item reusing a demo SKU gets none.
 */
export function demoPlaceholderImage(sku: string, entryId: string | null | undefined): string | null {
  const product = DEMO_PRODUCTS.find((candidate) => candidate.sku === sku.toUpperCase());
  if (!product) return null;
  const kind = demoProductKind(product);
  return entryId === `demo-${kind}` ? `/products/${kind}.svg` : null;
}

export function buildDemoProductEntries(links: readonly DemoCatalogLink[]) {
  const bySku = new Map(links.map((link) => [link.sku.toUpperCase(), link.catalogItemId]));
  return DEMO_PRODUCTS.flatMap((product) => {
    const commerceItemId = bySku.get(product.sku.toUpperCase());
    if (!commerceItemId) return [];
    const kind = demoProductKind(product);
    const id = `demo-${kind}`;
    return [{
      id,
      slug: id,
      status: "published" as const,
      data: {
        title: product.name,
        categories: [],
        commerce_item_id: commerceItemId,
        description: product.description,
        visual_label: VISUAL[kind] ?? "TEE",
      },
    }];
  });
}


/** The synthetic demo profile only; a shipping store never matches. */
export function isDemoCatalogProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DINKUS_CATALOG_PROFILE === "native-development" &&
    env.DINKUS_STOREFRONT_PROFILE === "proof";
}
