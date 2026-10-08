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
  categorySlugs: readonly string[];
  categoryTitles: readonly string[];
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
      references: { categories: true },
    });
    const memberships = result.entry?.references?.categories?.entries
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

export function canonicalCategoryPath(slug: string): string {
  return `/categories/${slug}`;
}

export const canonicalCollectionPath = canonicalCategoryPath;

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
  categories: readonly { id: string; data: Record<string, unknown> }[],
): { products: ProductEntry[]; errors: string[] } {
  const categoryMap = new Map<string, { title: string; description: string }>();
  for (const entry of categories) {
    const title = text(entry.data, "title");
    if (validProductSlug(entry.id) && title) {
      categoryMap.set(entry.id, {
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
    const categorySlugs = (Array.isArray(entry.data.categories)
      ? entry.data.categories
      : [])
      .filter(validProductSlug);
    if (!validProductSlug(entry.id) || !title || !visualLabel || !commerceItemId ||
        categorySlugs.some((slug) => !categoryMap.has(slug))) {
      errors.push(`invalid product entry: ${entry.id}`);
      continue;
    }
    if ((linkCounts.get(commerceItemId) ?? 0) > 1) {
      errors.push(`duplicate published Commerce itemId: ${commerceItemId}`);
      continue;
    }
    const categoryTitles = categorySlugs.map((slug) => categoryMap.get(slug)!.title);
    products.push({
      id: entry.id,
      slug: entry.id,
      title,
      description,
      visualLabel,
      commerceItemId,
      categorySlugs,
      categoryTitles,
      illustration: illustration(visualLabel),
    });
  }
  return { products, errors };
}

export function buildProductCategories(
  entries: readonly ProductEntry[],
): ProductCollection[] {
  const groups = new Map<string, ProductCollection>();
  for (const product of entries) {
    for (const [index, categorySlug] of product.categorySlugs.entries()) {
      const current = groups.get(categorySlug);
      if (current) {
        groups.set(categorySlug, { ...current, products: [...current.products, product] });
      } else {
        groups.set(categorySlug, {
          slug: categorySlug,
          title: product.categoryTitles[index]!,
          description: "",
          products: [product],
        });
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export const buildProductCollections = buildProductCategories;

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
