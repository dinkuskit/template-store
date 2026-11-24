/**
 * Each product's one standard category, from Shopify's Standard Product
 * Taxonomy pinned at 2026-11 (template-product-category-list-20261124). The
 * products field holds the bare Shopify id, such as "aa-1-13-8"; empty means
 * Uncategorized (template-product-category-field-20261124). The feeds send the
 * Google id it maps to, and the agent feed the Shopify id and name
 * (template-product-category-feeds-20261124).
 */

/** The products field that holds a product's standard category. */
export const PRODUCT_CATEGORY_FIELD = "product_category";
/** The taxonomy release this template pins; a newer one is a named upgrade step. */
export const PRODUCT_TAXONOMY_VERSION = "2026-11";

const ID = /^[a-z]{2}(-\d{1,4}){0,10}$/;
const GID = "gid://shopify/TaxonomyCategory/";

export interface StandardCategory {
  readonly taxonomy: "shopify";
  readonly version: string;
  /** Bare Shopify id, such as "aa-1-13-8". */
  readonly id: string;
  /** The category's own name, such as "Hats". */
  readonly name: string;
  /** Ancestors and the category joined with " > ", as Shopify writes it. */
  readonly fullName: string;
  /** Google product category id from Shopify's own mapping; absent when Shopify maps none. */
  readonly googleId?: string;
}

interface TaxonomyTable {
  version: string;
  names: Record<string, string>;
  google: Record<string, string>;
}

/**
 * The stored id as written, or null for an empty or malformed value. Shopify's
 * own "gid://shopify/TaxonomyCategory/..." form is accepted too.
 */
export function productCategoryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().replace(GID, "");
  return ID.test(id) ? id : null;
}

const parent = (id: string) => (id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : null);

/** Looks an id up in a loaded table; exported for tests. */
export function lookupStandardCategory(table: TaxonomyTable, value: unknown): StandardCategory | null {
  const id = productCategoryId(value);
  if (!id || !Object.hasOwn(table.names, id)) return null;
  const path: string[] = [];
  // The table keeps a Google id only where it differs from the parent's; ""
  // marks a category Shopify maps to nothing.
  let googleId: string | undefined;
  for (let at: string | null = id; at; at = parent(at)) {
    path.unshift(table.names[at] ?? "");
    if (googleId === undefined && Object.hasOwn(table.google, at)) googleId = table.google[at];
  }
  return {
    taxonomy: "shopify",
    version: table.version,
    id,
    name: table.names[id]!,
    fullName: path.join(" > "),
    ...(googleId ? { googleId } : {}),
  };
}

let loaded: Promise<TaxonomyTable> | undefined;

/**
 * The standard category a product's field names, or null when it is
 * Uncategorized or names no category in the pinned release. The ~600 KB table
 * loads on first use, so pages that never ask do not read it.
 */
export async function standardCategory(value: unknown): Promise<StandardCategory | null> {
  if (!productCategoryId(value)) return null;
  loaded ??= import("./taxonomy.json").then((module) => module.default as TaxonomyTable);
  return lookupStandardCategory(await loaded, value);
}
