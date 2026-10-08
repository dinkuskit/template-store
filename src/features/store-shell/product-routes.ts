import { getEmDashEntry } from "emdash";
import type { PublicCommerceProduct } from "../commerce-catalog/index.js";
import { readInstalledCommerceProduct, type InstalledCatalogContext } from "../commerce-catalog/installed.js";

export type ProductEntry = Readonly<{
  id: string;
  slug: string;
  title: string;
  description: string;
  visualLabel: string;
  commerceItemId: string;
  collectionSlugs: readonly string[];
  collectionTitles: readonly string[];
  illustration: "tee" | "hoodie" | "cap" | "beanie";
}>;

export type ProductCollection = Readonly<{
  slug: string;
  title: string;
  description: string;
  products: readonly ProductEntry[];
}>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function hydrateProductCollectionMembership(
  entries: readonly { id: string; data: Record<string, unknown> }[],
): Promise<readonly { id: string; data: Record<string, unknown> }[]> {
  return Promise.all(entries.map(async (entry) => {
    const result = await getEmDashEntry("products", entry.id, {
      references: { collections: true },
    });
    const memberships = result.entry?.references?.collections?.entries
      .map((collection) => collection.id) ?? [];
    return {
      ...entry,
      data: { ...entry.data, collections: memberships },
    };
  }));
}

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
  const linkCounts = new Map<string, number>();
  for (const entry of entries) {
    const link = text(entry.data, "commerce_item_id");
    if (link) linkCounts.set(link, (linkCounts.get(link) ?? 0) + 1);
  }
  const products: ProductEntry[] = [];
  for (const entry of entries) {
    const title = text(entry.data, "title");
    const description = text(entry.data, "description") ?? "";
    const visualLabel = text(entry.data, "visual_label");
    const commerceItemId = text(entry.data, "commerce_item_id");
    const collectionSlugs = (Array.isArray(entry.data.collections)
      ? entry.data.collections
      : [entry.data.collection])
      .filter(validProductSlug);
    if (!validProductSlug(entry.id) || !title || !visualLabel || !commerceItemId ||
        collectionSlugs.length === 0 || collectionSlugs.some((slug) => !collectionMap.has(slug))) {
      errors.push(`invalid product entry: ${entry.id}`);
      continue;
    }
    if ((linkCounts.get(commerceItemId) ?? 0) > 1) {
      errors.push(`duplicate published Commerce itemId: ${commerceItemId}`);
      continue;
    }
    const collectionTitles = collectionSlugs.map((slug) => collectionMap.get(slug)!.title);
    products.push({
      id: entry.id,
      slug: entry.id,
      title,
      description,
      visualLabel,
      commerceItemId,
      collectionSlugs,
      collectionTitles,
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
    for (const [index, collectionSlug] of product.collectionSlugs.entries()) {
      const current = groups.get(collectionSlug);
      if (current) {
        groups.set(collectionSlug, { ...current, products: [...current.products, product] });
      } else {
        groups.set(collectionSlug, {
          slug: collectionSlug,
          title: product.collectionTitles[index]!,
          description: "",
          products: [product],
        });
      }
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
