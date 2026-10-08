import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";
import { formatUsdMinor } from "../store-shell/price.js";
import type { PublicCommerceProduct } from "./index.js";
import { readCommerceGallery, readCommerceImage } from "./media.js";

const ROUTE = "catalog/public";
const STATUSES = new Set(["in-stock", "low-stock", "out-of-stock", "available-on-backorder", "availability-unavailable"]);

export interface InstalledCatalogContext {
  request: Request;
  runtime: {
    getPluginRouteMeta(pluginId: string, path: string): { public?: boolean; methods?: readonly string[] } | null;
    handlePublicPluginApiRoute(pluginId: string, method: string, path: string, request: Request): Promise<{ success: boolean; data?: unknown }>;
  } | null | undefined;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function product(value: unknown): PublicCommerceProduct {
  if (!object(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
      typeof value.name !== "string" || typeof value.sku !== "string" ||
      !object(value.price) || value.price.currency !== "USD" || typeof value.price.minor !== "string" ||
      !object(value.availability) || typeof value.availability.status !== "string" ||
      !STATUSES.has(value.availability.status) || value.availability.listable !== true ||
      typeof value.availability.sellable !== "boolean") throw new Error("Invalid installed catalog projection");
  return {
    id: value.id, name: value.name, sku: value.sku,
    // Commerce projects customerPays only; never reconstruct a regular/sale pair.
    price: { listable: true, regularText: formatUsdMinor(value.price.minor), saleText: null },
    availability: {
      status: value.availability.status as PublicCommerceProduct["availability"]["status"],
      sellable: value.availability.sellable, listable: true,
    },
    // A bad image degrades to a placeholder. It must not hide the price.
    image: readCommerceImage(value.image, value.name),
    gallery: readCommerceGallery(value.gallery, value.name),
  };
}

/** Public-only SSR dispatch preserves the installed plugin's original context. */
export async function readInstalledCommerceCatalog({ runtime, request }: InstalledCatalogContext): Promise<PublicCommerceProduct[]> {
  const metadata = runtime?.getPluginRouteMeta(COMMERCE_REGISTRY_RUNTIME_ID, ROUTE);
  if (!runtime || metadata?.public !== true || !metadata.methods?.includes("GET")) {
    throw new Error("Installed public catalog unavailable");
  }
  const products: PublicCommerceProduct[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL(`/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/${ROUTE}`, request.url);
    if (cursor) url.searchParams.set("cursor", cursor);
    // No incoming cookies, credentials, query parameters, or shopper capability.
    const result = await runtime.handlePublicPluginApiRoute(
      COMMERCE_REGISTRY_RUNTIME_ID, "GET", ROUTE, new Request(url, { method: "GET" }),
    );
    if (!result.success || !object(result.data) || !Array.isArray(result.data.products) || result.data.products.length > 50) {
      throw new Error("Installed public catalog unavailable");
    }
    for (const value of result.data.products) {
      const item = product(value);
      if (ids.has(item.id)) throw new Error("Duplicate installed catalog identity");
      ids.add(item.id); products.push(item);
    }
    const next = result.data.cursor;
    if (next !== undefined && (typeof next !== "string" || next.length < 1 || next.length > 1024 || cursors.has(next))) {
      throw new Error("Invalid installed catalog cursor");
    }
    cursor = next as string | undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor !== undefined);
  return products;
}
