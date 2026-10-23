/**
 * The store's publish check, Commerce half (template-product-states-20261023).
 *
 * Commerce never reads the CMS. When a signed-in person publishes, unpublishes
 * or trashes a Content > Products page, the store tells Commerce through its
 * private `catalog-items/set-on-sale` route, as that person, so the page's
 * product goes on sale or back to Draft with the page.
 */

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

type HandlerResult = { success: boolean; data?: unknown; error?: { message?: string } };

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

/**
 * Runs the content request, then, when it succeeded, tells Commerce. A failed
 * Commerce call leaves the page change in place and the product as it was;
 * the editor's Commerce panel shows which state the product is in.
 */
export async function withProductOnSale(
  input: { request: Request; url: URL; runtime: OnSaleRuntime | undefined; user: unknown; commercePluginId: string },
  next: () => Promise<Response>,
): Promise<Response> {
  const change = productPageChange(input.request.method, input.url.pathname);
  if (!change || !input.runtime || !input.user) return next();
  const locale = input.url.searchParams.get("locale") ?? undefined;
  const page = await productPage(input.runtime, change.entryId, locale).catch(() => null);
  const response = await next();
  if (!page || !response.ok) return response;
  const body = {
    catalogItemId: page.catalogItemId,
    entryId: page.id,
    onSale: change.action === "publish",
    ...(change.action === "trash" ? { deleted: true } : {}),
  };
  try {
    const result = await input.runtime.handlePluginApiRoute(
      input.commercePluginId,
      "POST",
      SET_ON_SALE_ROUTE,
      new Request(new URL(`/_emdash/api/plugins/${input.commercePluginId}/${SET_ON_SALE_ROUTE}`, input.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      input.user,
    );
    if (!result.success) console.warn("[product-on-sale] Commerce refused", change.action, result.error?.message ?? "");
  } catch (error) {
    console.warn("[product-on-sale] Commerce unavailable", change.action, error instanceof Error ? error.message : "");
  }
  return response;
}
