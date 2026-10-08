import type { PublicCommerceProduct } from "../commerce-catalog/index.js";
import { readInstalledCommerceProduct, type InstalledCatalogContext } from "../commerce-catalog/installed.js";

export type ProductEntry = Readonly<{
  id: string;
  slug: string;
  title: string;
  description: string;
  visualLabel: string;
  commerceItemId: string;
  collectionSlug: string;
  collectionTitle: string;
  illustration: "tee" | "hoodie" | "cap" | "beanie";
}>;

export type ProductCollection = Readonly<{
  slug: string;
  title: string;
  description: string;
  products: readonly ProductEntry[];
}>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function canonicalProductPath(slug: string): string {
  return `/products/${slug}`;
}

export function canonicalCollectionPath(slug: string): string {
  return `/collections/${slug}`;
}

export function validProductSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG.test(slug) && !slug.includes("/");
}

function text(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function illustration(value: string): ProductEntry["illustration"] {
  const normalized = value.toLowerCase();
  return normalized === "hoodie" || normalized === "cap" || normalized === "beanie"
    ? normalized
    : "tee";
}

export function readProductEntries(
  entries: readonly { id: string; data: Record<string, unknown> }[],
  collections: readonly { id: string; data: Record<string, unknown> }[],
): { products: ProductEntry[]; errors: string[] } {
  const collectionMap = new Map<string, { title: string; description: string }>();
  for (const entry of collections) {
    const title = text(entry.data, "title");
    if (validProductSlug(entry.id) && title) {
      collectionMap.set(entry.id, {
        title,
        description: text(entry.data, "description") ?? "",
      });
    }
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const products: ProductEntry[] = [];
  for (const entry of entries) {
    const title = text(entry.data, "title");
    const description = text(entry.data, "description") ?? "";
    const visualLabel = text(entry.data, "visual_label");
    const commerceItemId = text(entry.data, "commerce_item_id") ?? text(entry.data, "commerceItemId");
    const collectionSlug = text(entry.data, "collection");
    if (!validProductSlug(entry.id) || !title || !visualLabel || !commerceItemId ||
        !validProductSlug(collectionSlug) || !collectionMap.has(collectionSlug)) {
      errors.push(`invalid product entry: ${entry.id}`);
      continue;
    }
    if (seen.has(commerceItemId)) {
      errors.push(`duplicate published Commerce itemId: ${commerceItemId}`);
      continue;
    }
    seen.add(commerceItemId);
    const collection = collectionMap.get(collectionSlug)!;
    products.push({
      id: entry.id,
      slug: entry.id,
      title,
      description,
      visualLabel,
      commerceItemId,
      collectionSlug,
      collectionTitle: collection.title,
      illustration: illustration(visualLabel),
    });
  }
  return { products, errors };
}

export function buildProductCollections(
  entries: readonly ProductEntry[],
): ProductCollection[] {
  const groups = new Map<string, ProductCollection>();
  for (const product of entries) {
    const current = groups.get(product.collectionSlug);
    if (current) {
      groups.set(product.collectionSlug, { ...current, products: [...current.products, product] });
    } else {
      groups.set(product.collectionSlug, {
        slug: product.collectionSlug,
        title: product.collectionTitle,
        description: "",
        products: [product],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export async function resolvePublishedProduct(
  product: ProductEntry,
  context: InstalledCatalogContext,
): Promise<PublicCommerceProduct | null> {
  try {
    return await readInstalledCommerceProduct(product.commerceItemId, context);
  } catch {
    return null;
  }
}
