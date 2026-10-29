/**
 * The store's publish check, Commerce half (template-product-states-20261023).
 *
 * Commerce never reads the CMS. When a signed-in person publishes, unpublishes
 * or trashes a Content > Products page, the store tells Commerce through its
 * private `catalog-items/set-on-sale` route, as that person, so the page's
 * product goes on sale or back to Draft with the page.
 *
 * Commerce holds which product a page sells (template-no-commerce-box-20261029):
 * the store asks its private `catalog` route for the page's product and sends
 * set-on-sale the page alone. Only while an older store's page still has a
 * Commerce product field, and Commerce links that page to nothing, does the
 * store read the field and send its value, as it did before.
 */

import { hasPermission } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { SEEDED_PAGE_PRODUCTS } from "../store-shell/seeded-page-products.js";

export const SET_ON_SALE_ROUTE = "catalog-items/set-on-sale";
export const CATALOG_ROUTE = "catalog";

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
  return userById(runtime, id);
}

async function userById(runtime: OnSaleRuntime, id: string): Promise<unknown> {
  if (!runtime.db) return null;
  const fresh = await createKyselyAdapter(runtime.db as Parameters<typeof createKyselyAdapter>[0]).getUserById(id);
  return fresh && !fresh.disabled ? fresh : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The product's one name from a page title (catalog-page-title-is-name-20261026), within Commerce's name rules
 * (1-160 characters, no control characters); undefined when nothing is left.
 */
export function productName(title: unknown): string | undefined {
  if (typeof title !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const name = title.normalize("NFKC").replace(/[\u0000-\u001F\u007F\s]+/g, " ").trim().slice(0, 160).trim();
  return name || undefined;
}

/** The Commerce product a page sells, as this request knows it. */
type ProductPage = {
  id: string;
  catalogItemId: string;
  /** Read from an older store's Commerce product field because Commerce links the page to nothing. */
  fromField: boolean;
  published: boolean;
  scheduled: boolean;
  name?: string;
};
/** A page read: what it sells; null when it does not exist; "unlinked" when it sells nothing; "unreadable" when unknown. */
type PageRead = ProductPage | null | "unlinked" | "unreadable";
const sold = (read: PageRead): ProductPage | null => (typeof read === "object" ? read : null);
/** The product Commerce links to a page: its id, null when none, "failed" when Commerce could not answer. */
export type PageLink = (entryId: string) => Promise<string | null | "failed">;

/**
 * Asks Commerce's private `catalog` route, as `caller`, for the product a page sells: the one its panel picked, else
 * the one it last sold. A Commerce without that route (0.6.0) keeps no links, so it answers null.
 */
export function commercePageLink(runtime: OnSaleRuntime, pluginId: string, url: URL, caller: () => unknown): PageLink {
  return async (entryId) => {
    if (!runtime.getPluginRouteMeta(pluginId, CATALOG_ROUTE)) return null;
    try {
      const result = await runtime.handlePluginApiRoute(pluginId, "POST", CATALOG_ROUTE,
        new Request(new URL(`/_emdash/api/plugins/${pluginId}/${CATALOG_ROUTE}`, url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "get", entryId }),
        }), caller());
      if (!result.success) return "failed";
      const id = record(record(result.data)?.product)?.catalogItemId;
      return typeof id === "string" && id && id.length <= 1024 ? id : null;
    } catch {
      return "failed";
    }
  };
}

/**
 * The page's own id, the Commerce product it sells and, when published, the published title as the product's name.
 * Commerce's link comes first; an older store's field counts only while Commerce links the page to nothing or cannot
 * say. Null when the page does not exist, "unlinked" when it sells nothing, "unreadable" when that is unknown.
 */
async function productPage(runtime: OnSaleRuntime, link: PageLink, entryId: string, locale?: string): Promise<PageRead> {
  const found = await runtime.handleContentGet(PRODUCTS, entryId, locale, { includeDrafts: true }).catch(() => null);
  if (!found?.success) return found?.error?.code === "NOT_FOUND" ? null : "unreadable";
  const data = record(found.data);
  const item = record(data?.item) ?? data;
  const fields = record(item?.data) ?? item;
  const id = typeof item?.id === "string" ? item.id : entryId;
  const slug = typeof item?.slug === "string" ? item.slug : "";
  // The seed's demonstration pages name the template's own ids, which Commerce answers it does not have.
  const field = (typeof fields?.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "") || (SEEDED_PAGE_PRODUCTS[slug] ?? "");
  const linked = await link(id);
  const scheduled = typeof item?.scheduledAt === "string" && item.scheduledAt !== "";
  const published = item?.status === "published";
  // A newer unpublished draft keeps the published values in liveData; only a published title names the product.
  const name = published ? productName((record(item?.liveData) ?? fields)?.title) : undefined;
  const page = { id, published, scheduled, ...(name ? { name } : {}) };
  if (linked && linked !== "failed") return { ...page, catalogItemId: linked, fromField: false };
  if (field && field.length <= 1024) return { ...page, catalogItemId: field, fromField: true };
  return linked === "failed" ? "unreadable" : "unlinked";
}

/** What set-on-sale is told: the page alone, or with the product an older store's field names. */
const target = (page: ProductPage) => (page.fromField ? { catalogItemId: page.catalogItemId, entryId: page.id } : { entryId: page.id });

// Commerce answers these when it has no publish check for the page: the product or plugin is gone, or another
// page sells the product (a sandboxed route carries those only in its message). Commerce 0.6.0 names a gone
// product CATALOG_ITEM_NOT_FOUND.
// Title-only writes one request makes at most while the page's published title keeps changing under it.
const NAME_WRITES = 3;

const NOT_THIS_PAGES = new Set(["NOT_FOUND", "CATALOG_ITEM_NOT_FOUND", "ROUTE_NOT_FOUND", "PRODUCT_PAGE_CONFLICT"]);
const notThisPages = (error?: { code?: string; message?: string }) =>
  NOT_THIS_PAGES.has(error?.code ?? "") || /Another page sells this product|^Product not found\./.test(error?.message ?? "");

type Written = { failed: string | null; changed?: boolean; code?: string };

/** One `set-on-sale` write as `caller`: null when done (or Commerce has nothing to do for this page), else why it failed. */
async function setOnSale(runtime: OnSaleRuntime, pluginId: string, url: URL, caller: unknown, body: Record<string, unknown>): Promise<Written> {
  try {
    const result = await runtime.handlePluginApiRoute(pluginId, "POST", SET_ON_SALE_ROUTE,
      new Request(new URL(`/_emdash/api/plugins/${pluginId}/${SET_ON_SALE_ROUTE}`, url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), caller);
    if (result.success) return { failed: null, changed: record(result.data)?.changed === true };
    return { failed: notThisPages(result.error) ? null : result.error?.message ?? "Commerce refused", code: result.error?.code };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : "Commerce unavailable" };
  }
}

/**
 * Title-only writes (`name` with no `onSale`: Commerce renames the product this page sells and never changes whether
 * it is for sale) until Commerce has the page's newest published title. "retry" when the work is unfinished: Commerce
 * could not be reached or the title kept changing; "done" when it has the title, the page no longer sells this
 * product published, or this Commerce takes no title-only writes (0.6.0 refuses them as INVALID_INPUT).
 */
async function renameToTitle(name: string, catalogItemId: string, rename: (name: string) => Promise<Written>,
  read: () => Promise<PageRead>): Promise<"done" | "retry"> {
  for (let write = 1; write <= NAME_WRITES; write += 1) {
    const { failed, code } = await rename(name);
    // A sandboxed Commerce carries the reason only in its message.
    if (failed) return code === "INVALID_INPUT" || /\bInvalid onSale\b/.test(failed) ? "done" : "retry";
    const found = await read();
    if (found === "unreadable") return "retry";
    const now = sold(found);
    if (!now?.published || now.catalogItemId !== catalogItemId || !now.name || now.name === name) return "done";
    name = now.name;
  }
  return "retry";
}

/** The title EmDash's publish answered with, the page as just published; undefined when it cannot be read. */
async function publishedName(response: Response): Promise<string | undefined> {
  const body = record(await response.clone().json().catch(() => null));
  const data = record(body?.data);
  return productName(record(record(data?.item)?.data)?.title);
}

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
 * - A publish of a page that sells nothing is refused and names the Dinkus
 *   Commerce panel, as an older store refused a page with no product id.
 * - Unpublish and trash take the product off sale first. If Commerce refuses
 *   or cannot be reached, the page change is refused too, so a product is never
 *   left buyable behind an unpublished or trashed page.
 * - Publish puts the product on sale after the page is published. If that
 *   fails, the product stays a Draft (not buyable) and the page's Commerce
 *   panel shows it; publishing again retries.
 * - Publish names the product from the published page title. A title that an
 *   overlapping publish changed meanwhile is caught up with title-only writes,
 *   which never change whether the product is for sale.
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
  input: { request: Request; url: URL; runtime: OnSaleRuntime | undefined; user: unknown; commercePluginId: string; currentUser?: () => Promise<unknown>; pendingSales?: PendingSales },
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
  // The person as last read; writes that only take a product off sale again after an allowed write carry them.
  let authorized: unknown = input.user;
  const link = commercePageLink(runtime, input.commercePluginId, input.url, () => authorized);
  const read = () => productPage(runtime, link, change.entryId, locale);
  const found = await read();
  if (found === "unreadable") {
    // Unpublish and trash must not run blind: the page might sell a product that would stay buyable.
    return change.action === "publish" ? next() : refuse(503, "COMMERCE_UNAVAILABLE", "The page could not be checked for a product, so nothing was changed. Try again.");
  }
  if (found === "unlinked" && change.action === "publish") {
    return refuse(422, "PUBLISH_REJECTED", "This page has no product yet. Add price and stock in the Dinkus Commerce panel, then publish.");
  }
  const page = sold(found);
  if (!page) return next();
  authorized = await current();
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
    const result = await setOnSale(runtime, input.commercePluginId, input.url, authorized, { ...target(page), ...body });
    if (result.changed !== undefined) changed = result.changed;
    return result.failed;
  };
  // A title-only write, as the person read again, who must still hold the permission. It never changes sale state.
  const rename = async (name: string): Promise<Written> => {
    const now = await current();
    if (!may(now)) return { failed: "the person may no longer change sale state" };
    authorized = now;
    return setOnSale(runtime, input.commercePluginId, input.url, now, { ...target(page), name });
  };
  // Put the product on sale under the published title, then read the page again: if it is no longer published with
  // this product, take it off. If its published title is no longer the one just written (an overlapping publish
  // named it meanwhile), rename it to the title it has now with title-only writes, which never put anything on sale,
  // so whichever request reads last settles on the newest title. Work left unfinished is listed for the sweep.
  const putOnSale = async (name?: string) => {
    const failed = await tell({ onSale: true, ...(name ? { name } : {}) });
    if (failed) return failed;
    const now = sold(await read());
    if (now?.published && now.catalogItemId === page.catalogItemId) {
      if (now.name && now.name !== name &&
        (await renameToTitle(now.name, page.catalogItemId, rename, read)) === "retry") {
        if (input.pendingSales) await listRetitle(input.pendingSales, page.id, page.catalogItemId);
        else console.warn("[product-on-sale] the page's newest title did not reach Commerce; publishing again sends it");
      }
      return null;
    }
    const off = await tell({ onSale: false });
    if (off) console.warn("[product-on-sale] the page changed meanwhile and the product could not be taken off sale:", off);
    return "the page is no longer published as it was";
  };
  if (change.action === "publish") {
    const response = await next();
    const failed = response.ok && allowed ? await putOnSale(await publishedName(response)) : null;
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
    const now = sold(await read());
    const restored = now?.published && now.catalogItemId === page.catalogItemId ? await putOnSale(now.name) : "the page is no longer published as it was";
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

/** The product-url plugin's records of schedules made through the admin or MCP (`PendingSale`). */
export interface PendingSales {
  query(options: { limit: number; cursor?: string }): Promise<{ items: Array<{ id: string }>; cursor?: string }>;
  getVersioned(id: string): Promise<{ value: unknown; revision: string } | null>;
  compareAndDelete(id: string, revision: string): Promise<{ applied: boolean }>;
  put(id: string, value: unknown): Promise<void>;
}

// A product the sweep put on sale and must take off again (`takeback:<page>:<product digest>`, one per product, within
// EmDash's 1,024-character key limit); kept until Commerce confirms the off-sale write, and then removed only at the
// revision that write answered.
const TAKEBACK = "takeback:";
// A published page whose newest title Commerce does not have yet (`retitle:<page>:<product digest>`); the sweep
// renames the product with title-only writes, which never change whether it is for sale.
const RETITLE = "retitle:";
async function listKey(prefix: string, entryId: string, catalogItemId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(catalogItemId));
  return `${prefix}${entryId}:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
const takebackKey = (entryId: string, catalogItemId: string) => listKey(TAKEBACK, entryId, catalogItemId);
async function listRetitle(pendingSales: PendingSales, entryId: string, catalogItemId: string): Promise<void> {
  await pendingSales.put(await listKey(RETITLE, entryId, catalogItemId), { retitle: true, entryId, catalogItemId });
}

// `itemId` is the product an older store's field named when the page was scheduled; a page Commerce links names none.
type Grant = { by: string; role: number; itemId?: string };

/** The record's confirmed grant once EmDash's scheduled publish succeeded, else null; and when it last changed. */
function pendingSale(value: unknown): { grant: Grant | null; published: boolean; updatedAt: number } {
  const sale = record(value);
  const confirmed = record(sale?.confirmed);
  const by = typeof confirmed?.by === "string" ? confirmed.by : "";
  const itemId = typeof confirmed?.itemId === "string" ? confirmed.itemId : "";
  const role = typeof confirmed?.role === "number" ? confirmed.role : NaN;
  const grant = by && Number.isFinite(role) ? { by, role, ...(itemId ? { itemId } : {}) } : null;
  const updatedAt = typeof sale?.updatedAt === "string" ? Date.parse(sale.updatedAt) : NaN;
  return { grant, published: sale?.state === "published", updatedAt };
}

// A record whose scheduled publish has not completed is dropped once its page is no longer scheduled and the record is
// this old, so a schedule EmDash is still storing or publishing when the sweep reads it is not lost.
const STALE_PENDING_MS = 10 * 60_000;
const PENDING_BATCH = 50;

/**
 * EmDash publishes a scheduled page with nobody signed in, so the publish check
 * cannot put its product on sale then. This puts it on sale on the next request
 * from someone holding the route's permission, as that person:
 *
 * - Only schedules the product-url plugin recorded count, and only once EmDash
 *   stored the schedule and its own scheduled publish of the page succeeded. The
 *   grant names the person who scheduled it and their role then (and, on an
 *   older store's page with a Commerce product field, the product it named);
 *   they must have held the permission then and still hold it. An Author's
 *   schedule leaves the product a Draft, as their own publish does.
 * - The page must be published, sell a product (the granted one, if the grant
 *   names one) and not be scheduled again.
 *   A person's own publish, an unschedule, unpublish or trash removes the record.
 * - Before the write, the visitor is read again and the record must still be the
 *   one read (not removed or replaced meanwhile). After the write the page and
 *   the record are read again: if the page is no longer published with that
 *   product, or the record changed, the product goes off sale again.
 * - Records are read a batch at a time, all before the first write, resuming from
 *   `cursor` (returned for the next sweep), so every record is reached however
 *   many wait, and a change one write causes to another record is seen by that
 *   record's check.
 * - A sale write Commerce refuses keeps the record for a later sweep. Taking a
 *   product off sale again is recorded (one `takeback:` per product) before it is
 *   tried and retried on later sweeps until Commerce confirms it, and only the
 *   listing that write answered is removed; it never sells. Like every
 *   late off-sale write, it can at worst leave a published page's product a
 *   Draft, and publishing again fixes it.
 * - A page's newest published title that a request could not give its product
 *   (`retitle:`, one per product) is written by later sweeps with title-only
 *   writes, as the visitor read again, until Commerce has it. Those writes only
 *   rename the product the page sells and never change whether it is for sale.
 */
export async function sellScheduledPages(
  input: { url: URL; runtime: OnSaleRuntime | undefined; user: unknown; commercePluginId: string; currentUser?: () => Promise<unknown>; pendingSales?: PendingSales; userById?: (id: string) => Promise<unknown> },
  now = Date.now(),
  due: () => boolean = () => true,
  cursor?: string,
): Promise<string | undefined> {
  const { runtime, pendingSales } = input;
  if (!runtime || !input.user || !pendingSales) return cursor;
  const permission = runtime.getPluginRouteMeta(input.commercePluginId, SET_ON_SALE_ROUTE)?.permission;
  if (typeof permission !== "string") return cursor;
  const may = (who: unknown) => !!who && hasPermission(who as Parameters<typeof hasPermission>[0], permission as Parameters<typeof hasPermission>[1]);
  if (!may(input.user) || !due()) return cursor;
  const current = async () => (input.currentUser ? await input.currentUser().catch(() => null) : input.user);
  const link = commercePageLink(runtime, input.commercePluginId, input.url, () => input.user);
  const read = (entryId: string) => productPage(runtime, link, entryId);
  const batch = await pendingSales.query({ limit: PENDING_BATCH, ...(cursor ? { cursor } : {}) });
  const snapshot: Array<{ id: string; stored: { value: unknown; revision: string } }> = [];
  for (const { id } of batch.items) {
    const stored = await pendingSales.getVersioned(id);
    if (stored) snapshot.push({ id, stored });
  }
  // The listed take-back at `revision` is removed only once Commerce confirms its off-sale write. A take-back listed
  // again meanwhile has a new revision and stays for a later sweep (the write is safe to repeat).
  const offSale = async (visitor: unknown, key: string, revision: string, body: { entryId: string; catalogItemId?: string }) => {
    const { failed } = await setOnSale(runtime, input.commercePluginId, input.url, visitor, { ...body, onSale: false });
    if (failed) return failed;
    await pendingSales.compareAndDelete(key, revision);
    return null;
  };
  for (const { id, stored } of snapshot) {
    const visitorNow = async () => {
      const visitor = await current();
      return may(visitor) ? visitor : null;
    };
    if (id.startsWith(TAKEBACK)) {
      // A take-back names the product when an older store's field did; else Commerce takes off what the page last sold.
      const takeback = record(stored.value);
      const visitor = await visitorNow();
      if (!visitor) return cursor;
      const valid = typeof takeback?.entryId === "string" && (takeback.catalogItemId === undefined || typeof takeback.catalogItemId === "string");
      const failed = valid
        ? await offSale(visitor, id, stored.revision, {
          entryId: takeback.entryId as string,
          ...(typeof takeback.catalogItemId === "string" ? { catalogItemId: takeback.catalogItemId } : {}),
        })
        : null;
      if (!valid) await pendingSales.compareAndDelete(id, stored.revision);
      if (failed) console.warn("[product-on-sale] a product to take off sale again stays on the list:", failed);
      continue;
    }
    const unchanged = async () => (await pendingSales.getVersioned(id))?.revision === stored.revision;
    const drop = () => pendingSales.compareAndDelete(id, stored.revision);
    // Renames only, so it needs no grant: an allowed visitor gives the product its page's live published title.
    // Removed at the revision read once done, so a listing made meanwhile stays for the next sweep.
    const rename = (page: ProductPage) => async (name: string): Promise<Written> => {
      const visitor = await visitorNow();
      return visitor ? setOnSale(runtime, input.commercePluginId, input.url, visitor, { ...target(page), name }) : { failed: "the visitor may no longer change sale state" };
    };
    if (id.startsWith(RETITLE)) {
      const retitle = record(stored.value);
      const entryId = typeof retitle?.entryId === "string" ? retitle.entryId : "";
      const itemId = typeof retitle?.catalogItemId === "string" ? retitle.catalogItemId : "";
      const found = entryId && itemId ? await read(entryId) : null;
      if (found === "unreadable") continue;
      const page = sold(found);
      if (!page?.published || page.catalogItemId !== itemId || !page.name) {
        await drop();
        continue;
      }
      if (!(await visitorNow())) return cursor;
      if ((await renameToTitle(page.name, itemId, rename(page), () => read(entryId))) === "retry") {
        console.warn("[product-on-sale] a page's newest title stays on the list for a later sweep");
        continue;
      }
      await drop();
      continue;
    }
    const sale = pendingSale(stored.value);
    const found = await read(id);
    if (found === "unreadable") continue;
    const page = sold(found);
    if (!page) {
      await drop();
      continue;
    }
    if (page.scheduled) continue;
    if (!sale.published) {
      if (!(now - sale.updatedAt < STALE_PENDING_MS)) await drop();
      continue;
    }
    const grant = sale.grant;
    if (!grant || !page.published || (grant.itemId !== undefined && page.catalogItemId !== grant.itemId) || !may({ role: grant.role })) {
      await drop();
      continue;
    }
    const scheduler = await (input.userById ?? ((by: string) => userById(runtime, by)))(grant.by).catch(() => null);
    if (!may(scheduler)) {
      await drop();
      continue;
    }
    const visitor = await visitorNow();
    if (!visitor) return cursor;
    if (!(await unchanged())) continue;
    const body = target(page);
    const { failed } = await setOnSale(runtime, input.commercePluginId, input.url, visitor, { ...body, onSale: true, ...(page.name ? { name: page.name } : {}) });
    if (failed) {
      console.warn("[product-on-sale] a scheduled page's product stays a Draft for now:", failed);
      continue;
    }
    const after = sold(await read(id));
    const stillGranted = await unchanged().catch(() => false);
    if (stillGranted && after?.published && after.catalogItemId === page.catalogItemId) {
      // A publish that overlapped the sweep may have renamed the page: rename the product to the title it has now with
      // title-only writes, which never change whether it is for sale; unfinished work is listed for a later sweep.
      if (after.name && after.name !== page.name &&
        (await renameToTitle(after.name, page.catalogItemId, rename(page), () => read(id))) === "retry") {
        await listRetitle(pendingSales, page.id, page.catalogItemId);
      }
    } else {
      // Listed before it is tried. If another sweep lists the same product meanwhile, its on-sale write came before
      // this listing, so this off-sale write still answers it.
      const key = await takebackKey(page.id, page.catalogItemId);
      await pendingSales.put(key, { takeback: true, ...body });
      const listed = await pendingSales.getVersioned(key);
      const off = listed ? await offSale(visitor, key, listed.revision, body) : null;
      if (off) console.warn("[product-on-sale] the schedule or page changed meanwhile; taking the product off sale again is retried later:", off);
    }
    await drop();
  }
  return batch.cursor;
}

/**
 * `sellScheduledPages` at most once per interval in this isolate, counting only allowed people's requests and
 * moving through the records a batch per sweep; it never fails the request.
 */
export function scheduledSaleSweeper(everyMs = 60_000) {
  let nextAt = 0;
  let cursor: string | undefined;
  const due = (now: number) => () => {
    if (now < nextAt) return false;
    nextAt = now + everyMs;
    return true;
  };
  return async (input: Parameters<typeof sellScheduledPages>[0], now = Date.now()): Promise<void> => {
    try {
      cursor = await sellScheduledPages(input, now, due(now), cursor);
    } catch (error) {
      cursor = undefined;
      console.warn("[product-on-sale] scheduled pages were not checked:", error);
    }
  };
}
