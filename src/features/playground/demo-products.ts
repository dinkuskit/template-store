/**
 * Published EmDash `products` entries for the synthetic demo catalog
 * (playground and the demo profile only). Each entry is one seeded Commerce
 * item's `/products/<slug>` page; Commerce holds the link between them
 * (template-no-commerce-box-20261029). Real stores never call this.
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
 * Served under `/images/products/*.svg` so static placeholder assets never
 * collide with the `/products/[id]` route or the `/merch/*.svg` illustrations.
 */
export function demoPlaceholderImage(sku: string, entryId: string | null | undefined): string | null {
  const product = DEMO_PRODUCTS.find((candidate) => candidate.sku === sku.toUpperCase());
  if (!product) return null;
  const kind = demoProductKind(product);
  return entryId === `demo-${kind}` ? `/images/products/${kind}.svg` : null;
}

/** Each seeded demo item's page slug, for the items that exist. */
export function demoProductPages(links: readonly DemoCatalogLink[]): { slug: string; catalogItemId: string; product: DemoProductSeed }[] {
  const bySku = new Map(links.map((link) => [link.sku.toUpperCase(), link.catalogItemId]));
  return DEMO_PRODUCTS.flatMap((product) => {
    const catalogItemId = bySku.get(product.sku.toUpperCase());
    return catalogItemId ? [{ slug: `demo-${demoProductKind(product)}`, catalogItemId, product }] : [];
  });
}

export function buildDemoProductEntries(links: readonly DemoCatalogLink[]) {
  return demoProductPages(links).map(({ slug, product }) => ({
    id: slug,
    slug,
    status: "published" as const,
    data: {
      title: product.name,
      categories: [],
      description: product.description,
      visual_label: VISUAL[demoProductKind(product)] ?? "TEE",
    },
  }));
}


/**
 * The synthetic demo store: the proof storefront profile (pnpm dev:fresh and the proof store
 * the browser tests use), which runs the paired Commerce Registry build and seeds the demo catalog through it
 * (template-one-build-registry-20261031). A shipping store never matches.
 */
export function isDemoCatalogProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DINKUS_STOREFRONT_PROFILE === "proof" && env.DINKUS_CATALOG_PROFILE !== "native-development";
}
