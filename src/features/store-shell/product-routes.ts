import { getEmDashEntry } from "emdash";
import type { PublicCommerceProduct } from "../commerce-catalog/index.js";
import { readInstalledCommerceProduct, type InstalledCatalogContext } from "../commerce-catalog/installed.js";
import { offersCheckout, type CheckoutGateInput } from "../playground-checkout/index.js";
import { SEEDED_PAGE_PRODUCTS } from "./seeded-page-products.js";

export { SEEDED_PAGE_PRODUCTS };

export type ProductEntry = Readonly<{
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Optional placeholder art; most products have none and show Commerce's image. */
  visualLabel: string | null;
  commerceItemId: string;
  categorySlugs: readonly string[];
  categoryTitles: readonly string[];
  illustration: Illustration | null;
}>;

/** The template's own placeholder art; a store may sell anything (template-sells-anything-20261027). */
export type Illustration = "tee" | "hoodie" | "cap" | "beanie";

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
      data: { ...entry.data, categories: memberships },
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

/** Placeholder art named by the optional field, or none for every other value. */
export function illustration(value: string | null | undefined): Illustration | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "tee" || normalized === "hoodie" || normalized === "cap" || normalized === "beanie"
    ? normalized
    : null;
}

/** Each page's product as Commerce lists it: page entry id to Commerce product id. */
export function commercePageLinks(products: readonly { id: string; page?: string }[]): Map<string, string> {
  return new Map(products.flatMap((product) => (product.page ? [[product.page, product.id] as const] : [])));
}

/**
 * The Commerce product a page sells: the one Commerce links to the page (keyed
 * by the page's entry id, `data.id`), else the seed's demonstration for that
 * slug. Empty when none is known. The store never reads an older store's
 * Commerce product field (template-drop-older-store-box-20261101).
 */
export function pageCommerceItemId(
  entry: { id: string; data: Record<string, unknown> },
  links: ReadonlyMap<string, string> = new Map(),
): string {
  const pageId = typeof entry.data.id === "string" ? entry.data.id : "";
  return (pageId && links.get(pageId)) || SEEDED_PAGE_PRODUCTS[entry.id] || "";
}

/**
 * The published product pages with the product each sells. A page whose
 * product is not known (it sells nothing on the shop, or was never linked) is
 * listed in `unlinked`, not in `errors`, and is left out like an invalid one.
 */
export function readProductEntries(
  entries: readonly { id: string; data: Record<string, unknown> }[],
  categories: readonly { id: string; data: Record<string, unknown> }[],
  links: ReadonlyMap<string, string> = new Map(),
): { products: ProductEntry[]; errors: string[]; unlinked: string[] } {
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
  const unlinked: string[] = [];
  const itemIds = new Map(entries.map((entry) => [entry, pageCommerceItemId(entry, links)]));
  const linkCounts = new Map<string, number>();
  for (const link of itemIds.values()) {
    if (link) linkCounts.set(link, (linkCounts.get(link) ?? 0) + 1);
  }
  const products: ProductEntry[] = [];
  for (const entry of entries) {
    const title = text(entry.data, "title");
    const description = text(entry.data, "description") ?? "";
    const visualLabel = text(entry.data, "visual_label");
    const commerceItemId = itemIds.get(entry) ?? "";
    const categorySlugs = (Array.isArray(entry.data.categories)
      ? entry.data.categories
      : [])
      .filter(validProductSlug);
    if (!validProductSlug(entry.id) || !title ||
        categorySlugs.some((slug) => !categoryMap.has(slug))) {
      errors.push(`invalid product entry: ${entry.id}`);
      continue;
    }
    if (!commerceItemId) {
      unlinked.push(entry.id);
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
  return { products, errors, unlinked };
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

/**
 * Product pages offer Add to cart wherever the shop sells: a shipping storefront, and the demo store, whose
 * guest cart is browser-only intent that stays honest about its closed checkout (hosted-demo-007). Every
 * product sells from its page on Commerce's Registry build (template-one-build-registry-20261031), so the
 * page is the one place to add to the cart. The playground offers it only once DINKUS_CHECKOUT_ENABLED turns
 * its sandbox checkout on; otherwise its page shows the cart-and-checkout-unavailable notice instead.
 */
export function productPageOffersCart(input: CheckoutGateInput): boolean {
  return input.isPlayground ? offersCheckout(input) : true;
}
