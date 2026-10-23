/**
 * The store's publish check, Commerce half (template-product-states-20261023).
 *
 * Commerce never reads the CMS. When a signed-in person publishes, unpublishes
 * or trashes a Content > Products page, the store tells Commerce through its
 * private `catalog-items/set-on-sale` route, as that person, so the page's
 * product goes on sale or back to Draft with the page.
 */

import { hasPermission } from "@emdash-cms/auth";

export const SET_ON_SALE_ROUTE = "catalog-items/set-on-sale";

const PRODUCTS = "products";
const CONTENT_PATH = /^\/_emdash\/api\/content\/([^/]+)\/([^/]+)(?:\/(publish|unpublish))?$/;

export type ProductPageChange = { entryId: string; action: "publish" | "unpublish" | "trash" };

/** Which products-page change this request makes: publish, unpublish or trash, or null. */
export function productPageChange(method: string, pathname: string): ProductPageChange | null {
  const match = pathname.match(CONTENT_PATH);
  if (!match || match[1] !== PRODUCTS) return null;
  let entryId: string;
  try {
    entryId = decodeURIComponent(match[2] ?? "");
  } catch {
    return null;
  }
  if (!entryId || entryId.length > 1024) return null;
  if (method === "POST" && match[3]) return { entryId, action: match[3] as "publish" | "unpublish" };
  if (method === "DELETE" && !match[3]) return { entryId, action: "trash" };
  return null;
}

type HandlerResult = { success: boolean; data?: unknown; error?: { code?: string; message?: string } };

export interface OnSaleRuntime {
  handleContentGet(collection: string, id: string, locale?: string, options?: { includeDrafts: boolean }): Promise<HandlerResult>;
  handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, user?: unknown): Promise<HandlerResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The page's own id and the Commerce product it sells, read before the change. */
async function productPage(runtime: OnSaleRuntime, entryId: string, locale?: string) {
  const found = await runtime.handleContentGet(PRODUCTS, entryId, locale, { includeDrafts: true });
  if (!found.success) return null;
  const data = record(found.data);
  const item = record(data?.item) ?? data;
  const fields = record(item?.data) ?? item;
  const id = typeof item?.id === "string" ? item.id : entryId;
  const catalogItemId = typeof fields?.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "";
  return catalogItemId && catalogItemId.length <= 1024 ? { id, catalogItemId } : null;
}

// Commerce answers these when it has no publish check for the page: no such route yet, or another page sells the product.
const NOT_THIS_PAGES = new Set(["NOT_FOUND", "PRODUCT_PAGE_CONFLICT"]);

function refuse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Wraps a products-page publish, unpublish or trash with Commerce's half.
 *
 * - Only someone who may publish all content (`content:publish_any`, the
 *   route's own permission) changes a product's sale state. EmDash's
 *   handlePluginApiRoute does not check route permissions, so it is checked here.
 * - Unpublish and trash take the product off sale first. If Commerce refuses
 *   or cannot be reached, the page change is refused too, so a product is never
 *   left buyable behind an unpublished or trashed page.
 * - Publish puts the product on sale after the page is published. If that
 *   fails, the product stays a Draft (not buyable) and the page's Commerce
 *   panel shows it; publishing again retries.
 * - Trash drops the page's link afterwards.
 */
export async function withProductOnSale(
  input: { request: Request; url: URL; runtime: OnSaleRuntime | undefined; user: unknown; commercePluginId: string },
  next: () => Promise<Response>,
): Promise<Response> {
  const change = productPageChange(input.request.method, input.url.pathname);
  if (!change || !input.runtime || !input.user) return next();
  const runtime = input.runtime;
  const locale = input.url.searchParams.get("locale") ?? undefined;
  const page = await productPage(runtime, change.entryId, locale).catch(() => null);
  if (!page) return next();
  const allowed = hasPermission(input.user as Parameters<typeof hasPermission>[0], "content:publish_any");
  const tell = async (body: Record<string, unknown>) => {
    try {
      const result = await runtime.handlePluginApiRoute(input.commercePluginId, "POST", SET_ON_SALE_ROUTE,
        new Request(new URL(`/_emdash/api/plugins/${input.commercePluginId}/${SET_ON_SALE_ROUTE}`, input.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalogItemId: page.catalogItemId, entryId: page.id, ...body }),
        }), input.user);
      return result.success || NOT_THIS_PAGES.has(result.error?.code ?? "") ? null : result.error?.message ?? "Commerce refused";
    } catch (error) {
      return error instanceof Error ? error.message : "Commerce unavailable";
    }
  };
  if (change.action === "publish") {
    const response = await next();
    const failed = response.ok && allowed ? await tell({ onSale: true }) : null;
    if (failed) console.warn("[product-on-sale] the product stays a Draft:", failed);
    return response;
  }
  if (!allowed) return refuse(403, "FORBIDDEN", "This page sells a product. Ask an editor or admin to unpublish or trash it.");
  const failed = await tell({ onSale: false });
  if (failed) return refuse(503, "COMMERCE_UNAVAILABLE", "Commerce could not take this page's product off sale, so nothing was changed. Try again.");
  const response = await next();
  if (response.ok && change.action === "trash") {
    const dropped = await tell({ onSale: false, deleted: true });
    if (dropped) console.warn("[product-on-sale] the trashed page's link stays:", dropped);
  }
  return response;
}
