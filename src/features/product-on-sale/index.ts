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

/**
 * The page's own id, the Commerce product it sells and, when published, the published title as the product's
 * name; null when the page sells nothing or does not exist, "unreadable" when the read failed.
 */
async function productPage(runtime: OnSaleRuntime, entryId: string, locale?: string): Promise<{ id: string; catalogItemId: string; published: boolean; scheduled: boolean; name?: string } | null | "unreadable"> {
  const found = await runtime.handleContentGet(PRODUCTS, entryId, locale, { includeDrafts: true }).catch(() => null);
  if (!found?.success) return found?.error?.code === "NOT_FOUND" ? null : "unreadable";
  const data = record(found.data);
  const item = record(data?.item) ?? data;
  const fields = record(item?.data) ?? item;
  const id = typeof item?.id === "string" ? item.id : entryId;
  const catalogItemId = typeof fields?.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "";
  const scheduled = typeof item?.scheduledAt === "string" && item.scheduledAt !== "";
  const published = item?.status === "published";
  // A newer unpublished draft keeps the published values in liveData; only a published title names the product.
  const name = published ? productName((record(item?.liveData) ?? fields)?.title) : undefined;
  return catalogItemId && catalogItemId.length <= 1024 ? { id, catalogItemId, published, scheduled, ...(name ? { name } : {}) } : null;
}

// Commerce answers these when it has no publish check for the page: the product or plugin is gone, or another
// page sells the product (a sandboxed route carries those only in its message). Commerce 0.6.0 names a gone
// product CATALOG_ITEM_NOT_FOUND.
// On-sale writes one request makes at most while the page's published title keeps changing under it.
const NAME_WRITES = 3;

const NOT_THIS_PAGES = new Set(["NOT_FOUND", "CATALOG_ITEM_NOT_FOUND", "ROUTE_NOT_FOUND", "PRODUCT_PAGE_CONFLICT"]);
const notThisPages = (error?: { code?: string; message?: string }) =>
  NOT_THIS_PAGES.has(error?.code ?? "") || /Another page sells this product|^Product not found\./.test(error?.message ?? "");

/** One `set-on-sale` write as `caller`: null when done (or Commerce has nothing to do for this page), else why it failed. */
async function setOnSale(runtime: OnSaleRuntime, pluginId: string, url: URL, caller: unknown, body: Record<string, unknown>): Promise<{ failed: string | null; changed?: boolean }> {
  try {
    const result = await runtime.handlePluginApiRoute(pluginId, "POST", SET_ON_SALE_ROUTE,
      new Request(new URL(`/_emdash/api/plugins/${pluginId}/${SET_ON_SALE_ROUTE}`, url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), caller);
    if (result.success) return { failed: null, changed: record(result.data)?.changed === true };
    return { failed: notThisPages(result.error) ? null : result.error?.message ?? "Commerce refused" };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : "Commerce unavailable" };
  }
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
    const result = await setOnSale(runtime, input.commercePluginId, input.url, authorized, { catalogItemId: page.catalogItemId, entryId: page.id, ...body });
    if (result.changed !== undefined) changed = result.changed;
    return result.failed;
  };
  // Put the product on sale under the published title, then read the page again: if it is no longer published with
  // this product, take it off. If its published title is no longer the one just written (an overlapping publish
  // named it meanwhile), write the title it has now, so whichever request reads last settles on the newest title.
  const putOnSale = async (name?: string) => {
    for (let write = 1; ; write += 1) {
      const failed = await tell({ onSale: true, ...(name ? { name } : {}) });
      if (failed) return failed;
      const now = await productPage(runtime, change.entryId, locale);
      if (!(now && now !== "unreadable" && now.published && now.catalogItemId === page.catalogItemId)) break;
      if (!now.name || now.name === name || write === NAME_WRITES) return null;
      name = now.name;
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
    const now = await productPage(runtime, change.entryId, locale);
    const restored = now && now !== "unreadable" && now.published && now.catalogItemId === page.catalogItemId ? await putOnSale(now.name) : "the page is no longer published as it was";
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
async function takebackKey(entryId: string, catalogItemId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(catalogItemId));
  return `${TAKEBACK}${entryId}:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type Grant = { by: string; role: number; itemId: string };

/** The record's confirmed grant once EmDash's scheduled publish succeeded, else null; and when it last changed. */
function pendingSale(value: unknown): { grant: Grant | null; published: boolean; updatedAt: number } {
  const sale = record(value);
  const confirmed = record(sale?.confirmed);
  const by = typeof confirmed?.by === "string" ? confirmed.by : "";
  const itemId = typeof confirmed?.itemId === "string" ? confirmed.itemId : "";
  const role = typeof confirmed?.role === "number" ? confirmed.role : NaN;
  const grant = by && itemId && Number.isFinite(role) ? { by, role, itemId } : null;
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
 *   grant names the person who scheduled it, their role then, and the product;
 *   they must have held the permission then and still hold it. An Author's
 *   schedule leaves the product a Draft, as their own publish does.
 * - The page must be published with the granted product and not scheduled again.
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
  const batch = await pendingSales.query({ limit: PENDING_BATCH, ...(cursor ? { cursor } : {}) });
  const snapshot: Array<{ id: string; stored: { value: unknown; revision: string } }> = [];
  for (const { id } of batch.items) {
    const stored = await pendingSales.getVersioned(id);
    if (stored) snapshot.push({ id, stored });
  }
  // The listed take-back at `revision` is removed only once Commerce confirms its off-sale write. A take-back listed
  // again meanwhile has a new revision and stays for a later sweep (the write is safe to repeat).
  const offSale = async (visitor: unknown, key: string, revision: string, entryId: string, catalogItemId: string) => {
    const { failed } = await setOnSale(runtime, input.commercePluginId, input.url, visitor, { catalogItemId, entryId, onSale: false });
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
      const takeback = record(stored.value);
      const visitor = await visitorNow();
      if (!visitor) return cursor;
      const failed = typeof takeback?.entryId === "string" && typeof takeback.catalogItemId === "string"
        ? await offSale(visitor, id, stored.revision, takeback.entryId, takeback.catalogItemId)
        : null;
      if (!takeback || typeof takeback.entryId !== "string" || typeof takeback.catalogItemId !== "string") await pendingSales.compareAndDelete(id, stored.revision);
      if (failed) console.warn("[product-on-sale] a product to take off sale again stays on the list:", failed);
      continue;
    }
    const unchanged = async () => (await pendingSales.getVersioned(id))?.revision === stored.revision;
    const drop = () => pendingSales.compareAndDelete(id, stored.revision);
    const sale = pendingSale(stored.value);
    const page = await productPage(runtime, id);
    if (page === "unreadable") continue;
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
    if (!grant || !page.published || page.catalogItemId !== grant.itemId || !may({ role: grant.role })) {
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
    const body = { catalogItemId: grant.itemId, entryId: page.id };
    const { failed } = await setOnSale(runtime, input.commercePluginId, input.url, visitor, { ...body, onSale: true, ...(page.name ? { name: page.name } : {}) });
    if (failed) {
      console.warn("[product-on-sale] a scheduled page's product stays a Draft for now:", failed);
      continue;
    }
    let after = await productPage(runtime, id);
    let stillGranted = await unchanged().catch(() => false);
    // A publish that overlapped the sweep may have renamed the page: write the title it has now, then check again.
    if (stillGranted && after && after !== "unreadable" && after.published && after.catalogItemId === grant.itemId && after.name && after.name !== page.name) {
      const renamed = await setOnSale(runtime, input.commercePluginId, input.url, visitor, { ...body, onSale: true, name: after.name });
      if (renamed.failed) console.warn("[product-on-sale] a scheduled page's newer title did not reach Commerce:", renamed.failed);
      after = await productPage(runtime, id);
      stillGranted = await unchanged().catch(() => false);
    }
    if (!(stillGranted && after && after !== "unreadable" && after.published && after.catalogItemId === grant.itemId)) {
      // Listed before it is tried. If another sweep lists the same product meanwhile, its on-sale write came before
      // this listing, so this off-sale write still answers it.
      const key = await takebackKey(page.id, grant.itemId);
      await pendingSales.put(key, { takeback: true, ...body });
      const listed = await pendingSales.getVersioned(key);
      const off = listed ? await offSale(visitor, key, listed.revision, page.id, grant.itemId) : null;
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
