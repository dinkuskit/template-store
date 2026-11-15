import { getEmDashReferences } from "emdash";
import type { MerchCollection } from "./merch-catalog.js";

/** Order an already-filtered category by its CMS reference field, never adding products. */
export async function orderCategoryProducts(category: MerchCollection): Promise<MerchCollection> {
  if (category.items.length < 2) return category;
  const ranks = new Map<string, number>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    do {
      // The SDK resolves published references for public requests and staged
      // references in edit/preview mode. Walk every page, not just the first 20.
      const page = await getEmDashReferences("categories", category.slug, "products", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (page.error) return category;
      for (const entry of page.entries) {
        if (!ranks.has(entry.id)) ranks.set(entry.id, ranks.size);
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor)) return category;
        cursors.add(cursor);
      }
    } while (cursor);
  } catch {
    return category;
  }
  if (ranks.size === 0) return category;
  return {
    ...category,
    items: [...category.items].sort((a, b) =>
      (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER)),
  };
}
