/**
 * The store's publish check, Commerce half (template-product-states-20261023).
 *
 * Commerce never reads the CMS. When a signed-in person publishes, unpublishes
 * or trashes a Content > Products page, the store tells Commerce through its
 * private `catalog-items/set-on-sale` route, as that person, so the page's
 * product goes on sale or back to Draft with the page.
 */

import { hasPermission } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

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
  getPluginRouteMeta(pluginId: string, path: string): { permission?: string } | null;
  db?: unknown;
}

/** The signed-in person as stored now, or null once they are disabled or gone; read again before every Commerce write. */
export async function storedUser(runtime: OnSaleRuntime, user: unknown): Promise<unknown> {
  const id = record(user)?.id;
  if (typeof id !== "string" || !runtime.db) return user;
  const fresh = await createKyselyAdapter(runtime.db as Parameters<typeof createKyselyAdapter>[0]).getUserById(id);
  return fresh && !fresh.disabled ? fresh : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The page's own id and the Commerce product it sells, read before the change;
 * null when the page sells nothing or does not exist, "unreadable" when the read failed.
 */
async function productPage(runtime: OnSaleRuntime, entryId: string, locale?: string): Promise<{ id: string; catalogItemId: string; published: boolean } | null | "unreadable"> {
  const found = await runtime.handleContentGet(PRODUCTS, entryId, locale, { includeDrafts: true }).catch(() => null);
  if (!found?.success) return found?.error?.code === "NOT_FOUND" ? null : "unreadable";
  const data = record(found.data);
  const item = record(data?.item) ?? data;
  const fields = record(item?.data) ?? item;
  const id = typeof item?.id === "string" ? item.id : entryId;
  const catalogItemId = typeof fields?.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "";
  return catalogItemId && catalogItemId.length <= 1024 ? { id, catalogItemId, published: item?.status === "published" } : null;
}

// Commerce answers these when it has no publish check for the page: the product or plugin is gone, or another
// page sells the product (a sandboxed route carries that only in its message).
const NOT_THIS_PAGES = new Set(["NOT_FOUND", "ROUTE_NOT_FOUND", "PRODUCT_PAGE_CONFLICT"]);
const notThisPages = (error?: { code?: string; message?: string }) =>
  NOT_THIS_PAGES.has(error?.code ?? "") || /Another page sells this product/.test(error?.message ?? "");

function refuse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Wraps a products-page publish, unpublish or trash with Commerce's half.
 *
 * - Only someone holding the route's own permission (`content:publish_any`)
 *   changes a product's sale state. EmDash's handlePluginApiRoute does not
 *   check route permissions, so it is checked here, against the person as
 *   stored right before each write that can make a product buyable: one who
 *   loses it mid-request puts nothing (back) on sale.
 * - A Commerce without the route (0.5.0) has no publish check, so its pages
 *   change exactly as before, Authors' own pages included.
 * - Unpublish and trash take the product off sale first. If Commerce refuses
 *   or cannot be reached, the page change is refused too, so a product is never
 *   left buyable behind an unpublished or trashed page.
 * - Publish puts the product on sale after the page is published. If that
 *   fails, the product stays a Draft (not buyable) and the page's Commerce
 *   panel shows it; publishing again retries.
 * - Trash drops the page's link afterwards.
 * - If the page change fails after Commerce took the product off sale, the
 *   product goes back on sale; a page that cannot be read is not unpublished.
 *
 * Overlapping requests settle on the page's final state. Every write that puts
 * a product on sale is followed by a fresh read of the page, and takes the
 * product off sale again if the page is no longer published with it. A
 * successful unpublish takes the product off sale both before and after the
 * page change. So whichever lands last is an off-sale write, unless the page
 * really is published: an on-sale write either runs before the unpublish's
 * last off-sale write, or its own read comes after the page change and sees
 * it. A late off-sale write can only leave a published page's product a Draft,
 * which never sells anything it should not, and publishing again fixes it.
 */
export async function withProductOnSale(
  input: { request: Request; url: URL; runtime: OnSaleRuntime | undefined; user: unknown; commercePluginId: string; currentUser?: () => Promise<unknown> },
  next: () => Promise<Response>,
): Promise<Response> {
  const change = productPageChange(input.request.method, input.url.pathname);
  if (!change || !input.runtime || !input.user) return next();
  const runtime = input.runtime;
  const permission = runtime.getPluginRouteMeta(input.commercePluginId, SET_ON_SALE_ROUTE)?.permission;
  if (typeof permission !== "string") return next();
  const may = (who: unknown) => !!who && hasPermission(who as Parameters<typeof hasPermission>[0], permission as Parameters<typeof hasPermission>[1]);
  const current = async () => (input.currentUser ? await input.currentUser().catch(() => null) : input.user);
  const locale = input.url.searchParams.get("locale") ?? undefined;
  const page = await productPage(runtime, change.entryId, locale);
  if (page === "unreadable") {
    // Unpublish and trash must not run blind: the page might sell a product that would stay buyable.
    return change.action === "publish" ? next() : refuse(503, "COMMERCE_UNAVAILABLE", "The page could not be checked for a product, so nothing was changed. Try again.");
  }
  if (!page) return next();
  // The person as last read; writes that only take a product off sale again after an allowed write carry them.
  let authorized = await current();
  const allowed = may(authorized);
  // The Commerce answer: null when it is done (or has nothing to do for this page), else why it failed.
  let changed = false;
  let withdrawn = false;
  // A write that can make a product buyable (on sale, or undoing an off-sale write) and the off-sale write that
  // gates an unpublish or trash read the person again first and run only if they still hold the permission.
  // Off-sale writes after that only take back what this allowed request started, so they always run: a person
  // who lost the permission meanwhile never leaves a product buyable behind a page this request changed.
  const tell = async (body: Record<string, unknown>, recheck = body.onSale === true) => {
    if (recheck) {
      const now = await current();
      if (!may(now)) {
        withdrawn = true;
        return "the person may no longer change sale state";
      }
      authorized = now;
    }
    const caller = authorized;
    try {
      const result = await runtime.handlePluginApiRoute(input.commercePluginId, "POST", SET_ON_SALE_ROUTE,
        new Request(new URL(`/_emdash/api/plugins/${input.commercePluginId}/${SET_ON_SALE_ROUTE}`, input.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalogItemId: page.catalogItemId, entryId: page.id, ...body }),
        }), caller);
      if (result.success) changed = record(result.data)?.changed === true;
      return result.success || notThisPages(result.error) ? null : result.error?.message ?? "Commerce refused";
    } catch (error) {
      return error instanceof Error ? error.message : "Commerce unavailable";
    }
  };
  // Put the product on sale, then read the page again: if it is no longer published with this product, take it off.
  const putOnSale = async () => {
    const failed = await tell({ onSale: true });
    if (failed) return failed;
    const now = await productPage(runtime, change.entryId, locale);
    if (now && now !== "unreadable" && now.published && now.catalogItemId === page.catalogItemId) return null;
    const off = await tell({ onSale: false });
    if (off) console.warn("[product-on-sale] the page changed meanwhile and the product could not be taken off sale:", off);
    return "the page is no longer published as it was";
  };
  if (change.action === "publish") {
    const response = await next();
    const failed = response.ok && allowed ? await putOnSale() : null;
    if (failed) console.warn("[product-on-sale] the product stays a Draft:", failed);
    return response;
  }
  if (!allowed) return refuse(403, "FORBIDDEN", "This page sells a product. Ask an editor or admin to unpublish or trash it.");
  const failed = await tell({ onSale: false }, true);
  if (failed && withdrawn) return refuse(403, "FORBIDDEN", "This page sells a product. Ask an editor or admin to unpublish or trash it.");
  if (failed) return refuse(503, "COMMERCE_UNAVAILABLE", "Commerce could not take this page's product off sale, so nothing was changed. Try again.");
  const tookOff = changed;
  // The page change failed after Commerce took the product off sale. Put it back only if the page is still
  // published with that product, read before and again after the write, so an undo never outlasts another unpublish.
  const undo = async () => {
    if (!tookOff) return;
    const now = await productPage(runtime, change.entryId, locale);
    const restored = now && now !== "unreadable" && now.published && now.catalogItemId === page.catalogItemId ? await putOnSale() : "the page is no longer published as it was";
    if (restored) console.warn("[product-on-sale] the product stays a Draft after a failed page change:", restored);
  };
  let response: Response;
  try {
    response = await next();
  } catch (error) {
    await undo();
    throw error;
  }
  if (!response.ok) await undo();
  else if (change.action === "trash") {
    const dropped = await tell({ onSale: false, deleted: true });
    if (dropped) console.warn("[product-on-sale] the trashed page's link stays:", dropped);
  } else {
    // Off sale again after the page change, so an on-sale write that overlapped it cannot be the last word.
    const failed = await tell({ onSale: false });
    if (failed) console.warn("[product-on-sale] the product could not be taken off sale again after unpublish:", failed);
  }
  return response;
}
