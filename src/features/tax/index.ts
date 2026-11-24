import { installedPluginIds } from "@dinkuskit/courier";
import type { GuestCheckoutContact } from "../guest-cart/checkout-protocol.js";
import type { ServerCartPage } from "../guest-cart/server-view.js";
import { trustedStoreOrigin, type ServerCartContext } from "../guest-cart/server-cart.js";
import { withStoreRuntime, type StoreRuntime } from "../coupons/index.js";

/**
 * Sales tax at checkout (dinkuskit/tax ledger shared-addons-door). EmDash plugins cannot call each other, so as
 * checkout starts the store's own server code asks the Tax plugin for the rates of the order's address and hands
 * its answer to Commerce's private add-ons door beside Coupons'. Commerce takes the discounts off first, then works
 * out the tax, so Tax is never told what a coupon took off (tax-picks-rate-commerce-does-math).
 */
export const TAX_SLUG = "dinkus-tax";
const ANSWER_ROUTE = "checkout/answer";
const MAX_ANSWER_BYTES = 64 * 1024;

export type TaxLine = Readonly<{ item: string; price: string; qty: number }>;
/** Tax's answer as the add-ons door takes it: the address it priced, shipping's rate, and every line's rate. */
export type TaxAnswer = Readonly<{
  from: string; ref: string; to: string; shipRate: string;
  lines: readonly Readonly<{ item: string; price: string; qty: number; off: "0"; rate: string }>[];
}>;

const isPost = (runtime: StoreRuntime, id: string) => {
  const meta = runtime.getPluginRouteMeta?.(id, ANSWER_ROUTE);
  return Boolean(meta && meta.public === false && meta.methods?.some((method) => method.toUpperCase() === "POST"));
};

/**
 * Where the Tax plugin is. `absent` only when the store is sure Tax is not installed: not loaded by its own id, and no
 * active Registry install with its slug. A Tax that is installed but cannot be asked (no private POST route, its install
 * not loaded, more than one install, or the store's plugin list unreadable) is `unavailable`, so checkout waits rather
 * than starting untaxed.
 */
export type TaxPlugin = Readonly<{ kind: "absent" }> | Readonly<{ kind: "found"; id: string }> | Readonly<{ kind: "unavailable" }>;

export async function findTax(runtime: StoreRuntime): Promise<TaxPlugin> {
  const ids = installedPluginIds(runtime as never);
  if (ids.includes(TAX_SLUG)) return isPost(runtime, TAX_SLUG) ? { kind: "found", id: TAX_SLUG } : { kind: "unavailable" };
  // Registry installs live in the store's database; a runtime without one has none.
  if (!runtime.db) return { kind: "absent" };
  let rows: unknown[];
  try {
    rows = await runtime.db.selectFrom("_plugin_state").select(["plugin_id", "registry_slug"])
      .where("source", "=", "registry").where("status", "=", "active").execute();
  } catch {
    return { kind: "unavailable" };
  }
  const installs = rows.flatMap((row) => {
    const { plugin_id: id, registry_slug: slug } = (row ?? {}) as { plugin_id?: unknown; registry_slug?: unknown };
    return slug === TAX_SLUG ? [id] : [];
  });
  if (!installs.length) return { kind: "absent" };
  const [id] = installs;
  return installs.length === 1 && typeof id === "string" && ids.includes(id) && isPost(runtime, id) ? { kind: "found", id } : { kind: "unavailable" };
}

/** The cart's lines as the add-ons door names them: Commerce's line order (sorted by catalog item id), unit prices in cents. */
export function taxLines(page: ServerCartPage): TaxLine[] | null {
  const cart = page.result.cart?.lines ?? [];
  if (!cart.length || !page.snapshots) return null;
  const snapshots = new Map(page.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const lines: TaxLine[] = [];
  for (const { catalogItemId: item, quantity } of [...cart].sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId))) {
    const snapshot = snapshots.get(item);
    const price = snapshot?.found ? snapshot.price.unitMinor : null;
    if (!price || !/^\d{1,10}$/u.test(price)) return null;
    lines.push({ item, price, qty: quantity });
  }
  return lines;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const rate = (value: unknown): value is string => typeof value === "string" && /^\d{1,6}$/u.test(value);

/** Tax's answer, checked before it goes on: every line, in the order sent, with the price and quantity sent. */
export function parseTaxAnswer(raw: unknown, lines: readonly TaxLine[]): { answer: TaxAnswer | null } | null {
  if (!record(raw) || !Object.hasOwn(raw, "answer")) return null;
  const answer = raw.answer;
  if (answer === null) return { answer: null };
  if (!record(answer) || answer.from !== TAX_SLUG || typeof answer.ref !== "string" || typeof answer.to !== "string" || !rate(answer.shipRate) ||
    !Array.isArray(answer.lines) || answer.lines.length !== lines.length) return null;
  if (!answer.lines.every((line, index) => record(line) && line.item === lines[index]!.item && line.price === lines[index]!.price &&
    line.qty === lines[index]!.qty && line.off === "0" && rate(line.rate))) return null;
  return { answer: answer as TaxAnswer };
}

/**
 * What checkout does about sales tax. `none`: Tax is surely not installed, or it answered that the order's state is not
 * switched on, so checkout starts untaxed. `answer`: the rates go to Commerce beside the coupon answer, if there is one.
 * `unavailable`: Tax is or may be installed but did not answer, so checkout waits rather than starting without the tax
 * it may owe.
 */
export type TaxCheck = Readonly<{ kind: "none" }> | Readonly<{ kind: "answer"; answer: TaxAnswer }> | Readonly<{ kind: "unavailable" }>;

export async function checkTax(ctx: ServerCartContext, page: ServerCartPage, contact: GuestCheckoutContact): Promise<TaxCheck> {
  const origin = trustedStoreOrigin(ctx);
  const checked = await withStoreRuntime<TaxCheck>(async (runtime) => {
    const tax = await findTax(runtime);
    if (tax.kind !== "found") return { kind: tax.kind === "absent" ? "none" : "unavailable" };
    const { id } = tax;
    // The delivery address; billing when nothing ships, as Commerce names the address it taxes.
    const address = contact.delivery ?? contact.billing;
    const lines = taxLines(page);
    if (!address || !lines) return { kind: "unavailable" };
    try {
      const raw = await runtime.handlePluginApiRoute(id, "POST", ANSWER_ROUTE, new Request(new URL(`/_emdash/api/plugins/${id}/${ANSWER_ROUTE}`, origin), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, lines }),
      }));
      const text = JSON.stringify(raw);
      if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_ANSWER_BYTES) return { kind: "unavailable" };
      const body = JSON.parse(text) as unknown;
      const parsed = parseTaxAnswer(record(body) && body.success === true ? body.data : null, lines);
      if (!parsed) return { kind: "unavailable" };
      return parsed.answer ? { kind: "answer", answer: parsed.answer } : { kind: "none" };
    } catch {
      return { kind: "unavailable" };
    }
  });
  // No store runtime: Commerce cannot be reached either, and whether Tax is installed is unknown.
  return checked ?? { kind: "unavailable" };
}

export const TAX_UNAVAILABLE = "Sales tax can't be worked out right now. Try again in a moment.";
