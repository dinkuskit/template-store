import { installedPluginIds } from "@dinkuskit/courier";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";

/**
 * The checkout page's coupon box (template-checkout-coupon-box-20261124). EmDash plugins cannot call each other, so
 * the store's own server code asks the Coupons plugin about the typed codes and hands its answer to Commerce's
 * private add-ons door (commerce-addons-door-20261124). Both are private routes, called here with nobody signed in.
 */
export const COUPONS_SLUG = "dinkus-coupons";
export const COUPON_CODES_MAX = 6;
export const COUPON_CODE_MAX = 64;
const ANSWER_ROUTE = "checkout/answer";
const ADDONS_ROUTE = "checkout/addons/start";
const MAX_ANSWER_BYTES = 64 * 1024;

/** The part of EmDash's runtime this file uses. */
export type StoreRuntime = Readonly<{
  handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request): Promise<unknown>;
  getPluginRouteMeta?(pluginId: string, path: string): { public?: boolean; methods?: string[] } | null;
  db?: { selectFrom(table: string): { select(columns: string[]): { where(...args: unknown[]): { where(...args: unknown[]): { execute(): Promise<unknown[]> } } } } };
}>;

/** Runs `run` with the store's own EmDash runtime, as the courier does; null when there is none. */
export async function withStoreRuntime<T>(run: (runtime: StoreRuntime) => Promise<T>): Promise<T | null> {
  try {
    const { withEmDashRuntime } = await import("emdash/middleware") as unknown as {
      withEmDashRuntime<R>(run: (runtime: StoreRuntime) => Promise<R>): Promise<R>;
    };
    return await withEmDashRuntime(run);
  } catch {
    return null;
  }
}

const isPost = (runtime: StoreRuntime, id: string, path: string) => {
  const meta = runtime.getPluginRouteMeta?.(id, path);
  return Boolean(meta && meta.public === false && meta.methods?.some((method) => method.toUpperCase() === "POST"));
};

/** The installed Coupons plugin's id: its own id outside the Registry, or the Registry install whose slug is dinkus-coupons. */
export async function couponsPluginId(runtime: StoreRuntime): Promise<string | null> {
  const ids = installedPluginIds(runtime as never);
  if (ids.includes(COUPONS_SLUG) && isPost(runtime, COUPONS_SLUG, ANSWER_ROUTE)) return COUPONS_SLUG;
  try {
    const rows = await runtime.db?.selectFrom("_plugin_state").select(["plugin_id", "registry_slug"])
      .where("source", "=", "registry").where("status", "=", "active").execute() ?? [];
    const found = rows.flatMap((row) => {
      const { plugin_id: id, registry_slug: slug } = (row ?? {}) as { plugin_id?: unknown; registry_slug?: unknown };
      return typeof id === "string" && slug === COUPONS_SLUG && ids.includes(id) && isPost(runtime, id, ANSWER_ROUTE) ? [id] : [];
    });
    return found.length === 1 ? found[0]! : null;
  } catch {
    return null;
  }
}

/** A checkout line as Coupons takes it: in Commerce's line order, the unit price in whole cents. */
export type CouponLine = Readonly<{ item: string; product: string; price: string; quantity: number; sale: boolean; categories: readonly string[] }>;
export type CouponResult =
  | Readonly<{ code: string; ok: true; off: string; freeShipping: boolean }>
  | Readonly<{ code: string; ok: false; reason: string; message: string }>;
export type AddonAnswer = Readonly<{ from: string; ref?: string; codes: readonly string[]; ship?: "free"; lines: readonly { item: string; price: string; off: string }[] }>;
export type CouponAnswer = Readonly<{ codes: readonly CouponResult[]; answer: AddonAnswer | null }>;

export type CouponAsk = Readonly<{
  /** The cart key's public half; Coupons keeps only a hash of it. */
  cart: string;
  connection?: string;
  email?: string;
  codes: readonly string[];
  lines: readonly CouponLine[];
  hold: boolean;
}>;

function unwrap(body: unknown): unknown {
  return body && typeof body === "object" && (body as { success?: unknown }).success === true ? (body as { data?: unknown }).data : null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const cents = (value: unknown): value is string => typeof value === "string" && /^\d{1,10}$/u.test(value);

/** Coupons' answer, checked before anything is shown or sent on. */
export function parseCouponAnswer(raw: unknown, lines: readonly CouponLine[]): CouponAnswer | null {
  if (!record(raw) || !Array.isArray(raw.codes)) return null;
  const codes: CouponResult[] = [];
  for (const entry of raw.codes) {
    if (!record(entry) || typeof entry.code !== "string" || entry.code.length > COUPON_CODE_MAX) return null;
    if (entry.ok === true && cents(entry.off) && typeof entry.freeShipping === "boolean") codes.push({ code: entry.code, ok: true, off: entry.off, freeShipping: entry.freeShipping });
    else if (entry.ok === false && typeof entry.reason === "string" && typeof entry.message === "string" && entry.message.length <= 200) {
      codes.push({ code: entry.code, ok: false, reason: entry.reason, message: entry.message });
    } else return null;
  }
  const answer = raw.answer;
  if (answer === null) return { codes, answer: null };
  if (!record(answer) || answer.from !== COUPONS_SLUG || !Array.isArray(answer.codes) || !Array.isArray(answer.lines) ||
      answer.lines.length !== lines.length) return null;
  // Every line, in the order sent; Commerce checks the items and prices once more.
  if (!answer.lines.every((line, index) => record(line) && line.item === lines[index]!.item && line.price === lines[index]!.price && cents(line.off))) return null;
  return { codes, answer: answer as AddonAnswer };
}

/** Asks Coupons about the typed codes; null when Coupons is not installed or did not answer. */
export async function askCoupons(origin: string, ask: CouponAsk): Promise<CouponAnswer | null> {
  return withStoreRuntime(async (runtime) => {
    const id = await couponsPluginId(runtime);
    if (!id) return null;
    const body = {
      cart: ask.cart,
      ...(ask.connection ? { connection: ask.connection } : {}),
      ...(ask.email ? { email: ask.email } : {}),
      codes: ask.codes,
      lines: ask.lines,
      ...(ask.hold ? { hold: true } : {}),
    };
    const raw = await runtime.handlePluginApiRoute(id, "POST", ANSWER_ROUTE, new Request(new URL(`/_emdash/api/plugins/${id}/${ANSWER_ROUTE}`, origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const text = JSON.stringify(raw);
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_ANSWER_BYTES) return null;
    return parseCouponAnswer(unwrap(JSON.parse(text)), ask.lines);
  });
}

/**
 * Whether the box takes codes: the store has the Coupons plugin, and its Commerce has the add-ons door
 * (commerce-addons-door-20261124). A Commerce release without the door leaves the old disabled box, so Coupons
 * installed first never shows a code that checkout could not carry.
 */
export async function couponsInstalled(commerceId: string = COMMERCE_REGISTRY_RUNTIME_ID): Promise<boolean> {
  return Boolean(await withStoreRuntime(async (runtime) =>
    isPost(runtime, commerceId, ADDONS_ROUTE) && Boolean(await couponsPluginId(runtime))));
}

/** The codes the form carries: kept ones, minus a removed one, plus a newly typed one; at most 6, no repeats. */
export function readCouponForm(form: FormData): Readonly<{ codes: string[]; applying: boolean }> {
  const typed = String(form.get("couponCode") ?? "").trim();
  const removed = String(form.get("couponRemove") ?? "").trim().toUpperCase();
  const kept = form.getAll("coupon").map((value) => String(value).trim());
  const codes: string[] = [];
  for (const code of [...kept, typed]) {
    if (!code || code.length > COUPON_CODE_MAX || code.toUpperCase() === removed) continue;
    if (codes.some((other) => other.toUpperCase() === code.toUpperCase())) continue;
    if (codes.length < COUPON_CODES_MAX) codes.push(code);
  }
  return { codes, applying: form.get("intent") === "apply" || removed.length > 0 };
}

/** Gives a cart's held uses back when checkout starts with no code; holds lapse on their own after an hour. */
export async function releaseCoupons(origin: string, cart: string): Promise<void> {
  await withStoreRuntime(async (runtime) => {
    const id = await couponsPluginId(runtime);
    if (!id) return;
    await runtime.handlePluginApiRoute(id, "POST", "checkout/release", new Request(new URL(`/_emdash/api/plugins/${id}/checkout/release`, origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cart }),
    }));
  });
}
