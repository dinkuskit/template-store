import { getEmDashCollection } from "emdash";
import { readCommerceCatalog } from "../commerce-catalog/index.js";
import type { InstalledCatalogContext } from "../commerce-catalog/installed.js";
import { leftCommerceCatalog } from "./merch-catalog.js";
import { readProductEntries, type ProductEntry } from "./product-routes.js";
import { readStorefrontProfile, type StorefrontProfile } from "./profile.js";
import { readProofDemonstrations } from "./proof-demonstrations.js";

export type HighlightedSnippetPart = Readonly<{
  text: string;
  highlighted: boolean;
}>;

const BASIC_ENTITY_MAP: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeBasicEntities(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|#39|apos);/giu, (match) => {
    return BASIC_ENTITY_MAP[match.toLowerCase()] ?? match;
  });
}

function stripOtherHtmlTags(input: string): string {
  return decodeBasicEntities(input.replace(/<[^>]*>/gu, ""));
}

/**
 * Splits an EmDash FTS5 snippet containing `<mark>...</mark>` wrappers into
 * safe plain-text segments so Astro templates can render `<mark>` elements
 * without `set:html`. Other raw HTML tags in indexed text are stripped.
 */
export function renderHighlightedSnippetParts(
  snippet: string | null | undefined,
): HighlightedSnippetPart[] {
  if (!snippet) return [];
  const parts: HighlightedSnippetPart[] = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/giu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      const text = stripOtherHtmlTags(snippet.slice(lastIndex, match.index));
      if (text) parts.push({ text, highlighted: false });
    }
    const highlightedText = stripOtherHtmlTags(match[1] ?? "");
    if (highlightedText) {
      parts.push({ text: highlightedText, highlighted: true });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < snippet.length) {
    const trailing = stripOtherHtmlTags(snippet.slice(lastIndex));
    if (trailing) parts.push({ text: trailing, highlighted: false });
  }

  return parts;
}

export interface SearchProductVisibilityOptions {
  profile: StorefrontProfile;
  catalogAvailable: boolean;
  activeCommerceIds: ReadonlySet<string>;
  managedListable: boolean;
  unmanagedListable: boolean;
}

/**
 * Determines whether a validated EmDash `products` entry should appear in
 * public storefront search/suggest results under the current storefront
 * profile and Commerce catalog state.
 */
export function isSearchProductVisibleOnStorefront(
  product: Pick<ProductEntry, "id" | "slug" | "commerceItemId">,
  options: SearchProductVisibilityOptions,
): boolean {
  if (product.commerceItemId === "dinkus-template-managed-product") {
    if (options.profile === "shipping") {
      return options.catalogAvailable && options.activeCommerceIds.has(product.commerceItemId);
    }
    return options.managedListable;
  }
  if (product.commerceItemId === "dinkus-template-unmanaged-product") {
    if (options.profile === "shipping") {
      return options.catalogAvailable && options.activeCommerceIds.has(product.commerceItemId);
    }
    return options.unmanagedListable;
  }

  const shouldEnforceCommerceCatalog =
    options.profile === "shipping" ||
    (options.catalogAvailable && options.activeCommerceIds.size > 0);

  if (
    shouldEnforceCommerceCatalog &&
    leftCommerceCatalog(
      product.commerceItemId,
      options.catalogAvailable && options.activeCommerceIds.has(product.commerceItemId),
    )
  ) {
    return false;
  }

  return true;
}

const STOREFRONT_COLLECTION_SLUGS = new Set(["products", "categories", "pages"]);

export function filterStorefrontSearchHits<
  T extends { collection?: unknown; id?: unknown; slug?: unknown },
>(hits: readonly T[], visibleProductSlugs: ReadonlySet<string>): T[] {
  return hits.filter((hit) => {
    if (typeof hit.collection === "string" && !STOREFRONT_COLLECTION_SLUGS.has(hit.collection)) {
      return false;
    }
    if (hit.collection !== "products") return true;
    const candidate =
      typeof hit.slug === "string" && hit.slug.length > 0
        ? hit.slug
        : typeof hit.id === "string"
          ? hit.id
          : "";
    return candidate.length > 0 && visibleProductSlugs.has(candidate);
  });
}

/**
 * Resolves the set of published `products` entry slugs/IDs that are currently
 * visible on the public storefront, excluding entries rejected by
 * `readProductEntries`, suppressed demonstration items, and products whose
 * linked Commerce catalog item was archived or removed.
 */
export async function loadVisibleStorefrontProductSlugs(
  context: InstalledCatalogContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Set<string>> {
  const [productCollection, categoryCollection, demonstrations] = await Promise.all([
    getEmDashCollection<"products", Record<string, unknown>>("products", {
      status: "published",
    }).catch(() => ({ entries: [] })),
    getEmDashCollection<"categories", Record<string, unknown>>("categories", {
      status: "published",
    }).catch(() => ({ entries: [] })),
    readProofDemonstrations(env).catch(() => null),
  ]);

  const { products } = readProductEntries(
    productCollection.entries,
    categoryCollection.entries,
  );
  const profile = readStorefrontProfile(env);

  let catalogAvailable = true;
  const commerceProducts = await readCommerceCatalog(context).catch(() => {
    catalogAvailable = false;
    return [];
  });
  const activeCommerceIds = new Set(commerceProducts.map((item) => item.id));

  const visible = new Set<string>();
  const visibilityOptions: SearchProductVisibilityOptions = {
    profile,
    catalogAvailable,
    activeCommerceIds,
    managedListable: demonstrations?.managed.price.listable === true,
    unmanagedListable: demonstrations?.unmanaged.price.listable === true,
  };

  for (const product of products) {
    if (isSearchProductVisibleOnStorefront(product, visibilityOptions)) {
      visible.add(product.id);
      visible.add(product.slug);
    }
  }
  return visible;
}
