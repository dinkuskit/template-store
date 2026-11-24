import { getEmDashCollection, getEmDashEntry } from "emdash";

import { readCommerceCatalog } from "../commerce-catalog/index.js";
import type { ServerCartPage } from "../guest-cart/server-view.js";
import type { CouponLine } from "./index.js";

type CatalogContext = Parameters<typeof readCommerceCatalog>[0];

/**
 * The cart's lines as Coupons takes them, in Commerce's line order (cart lines sorted by catalog item id), with each
 * item's product, whether it is on sale, and its product page's categories. Null when a line's price is unknown.
 */
export async function couponLines(page: ServerCartPage, context: CatalogContext): Promise<CouponLine[] | null> {
  const cart = page.result.cart?.lines ?? [];
  if (!cart.length || !page.snapshots) return null;
  const snapshots = new Map(page.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const catalog = await readCommerceCatalog(context).catch(() => []);
  const productOf = (item: string) => catalog.find((product) => product.id === item || product.variants?.some((member) => member.id === item));
  const pages = await getEmDashCollection<"products", Record<string, unknown>>("products", { status: "published" }).catch(() => null);
  const categoriesOf = new Map<string, string[]>();
  const lines: CouponLine[] = [];
  for (const { catalogItemId: item, quantity } of [...cart].sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId))) {
    const snapshot = snapshots.get(item);
    const price = snapshot?.found ? snapshot.price.unitMinor : null;
    if (!snapshot?.found || !price || !/^\d{1,10}$/u.test(price)) return null;
    const product = productOf(item);
    let categories: string[] = [];
    if (product?.page) {
      if (!categoriesOf.has(product.page)) {
        const entry = pages?.entries.find((candidate) => candidate.data.id === product.page);
        const full = entry ? await getEmDashEntry("products", entry.id, { references: { categories: true } }).catch(() => null) : null;
        categoriesOf.set(product.page, full?.entry?.references?.categories?.entries.map((category) => category.id) ?? []);
      }
      categories = categoriesOf.get(product.page)!;
    }
    lines.push({ item, product: product?.id ?? item, price, quantity, sale: Boolean(snapshot.price.saleText), categories });
  }
  return lines;
}
