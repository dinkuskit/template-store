import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";
import { formatCheckoutMoneyValue, formatConfirmedDeliveryAddress } from "../guest-cart/order-view.js";
import { readBoundedForm, sameStoreRequest, trustedStoreOrigin, type ServerCartContext } from "../guest-cart/server-cart.js";

/**
 * The order lookup page at /track-order, like WooCommerce's Track your order: order number plus checkout email shows
 * that one order (commerce-order-lookup-20261122). The form posts to its own page, which asks Commerce's
 * orders/lookup route inside the server, so the page needs no script. Commerce limits wrong guesses.
 */
export const ORDER_LOOKUP_PATH = "/track-order";
const ROUTE = "orders/lookup";
/** An order number and an email fit well under 2 KB; a longer body is never parsed. */
const MAX_FORM_BYTES = 2 * 1024;
/** One order with its lines fits well under 64 KB; a longer answer is refused. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export const ORDER_LOOKUP_TEXT = Object.freeze({
  INVALID_INPUT: "Enter your order number and the email used at checkout.",
  ORDER_NOT_FOUND: "No order matches that order number and email. Check both and try again.",
  LOOKUP_LIMITED: "Too many tries. Try again in an hour.",
  UNAVAILABLE: "Order lookup is unavailable right now. Try again in a moment.",
});
type LookupCode = keyof typeof ORDER_LOOKUP_TEXT;

type Money = Readonly<{ currency: string; minor: string }>;

export type OrderLookupView = Readonly<{
  number: string;
  status: "Processing" | "Completed";
  paidOn: string | null;
  lines: readonly Readonly<{ id: string; text: string; options: string | null; amount: string }>[];
  totals: readonly Readonly<{ label: string; amount: string }>[];
  recipient: string | null;
  address: string | null;
  carrier: string | null;
  tracking: string | null;
}>;

export type OrderLookupForm = Readonly<{ orderNumber: string; email: string }>;

export type OrderLookupOutcome =
  | Readonly<{ ok: true; order: OrderLookupView }>
  | Readonly<{ ok: false; code: LookupCode; message: string; form: OrderLookupForm }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function money(value: unknown): Money | null {
  const raw = record(value);
  return raw && typeof raw.minor === "string" && /^-?\d{1,15}$/u.test(raw.minor) &&
    typeof raw.currency === "string" && /^[A-Z]{3}$/u.test(raw.currency)
    ? { minor: raw.minor, currency: raw.currency }
    : null;
}

function amount(value: Money | null, { free = false, minus = false } = {}): string | null {
  if (!value) return null;
  if (free && value.minor === "0") return "Free";
  const shown = formatCheckoutMoneyValue(value);
  return shown && minus ? `-${shown}` : shown;
}

function paidOn(value: unknown): string | null {
  const iso = text(value, 64);
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(time))
    : null;
}

function delivery(value: unknown): { name: string; address: string } | null {
  const raw = record(value);
  const name = text(raw?.name), line1 = text(raw?.line1), city = text(raw?.city);
  const postalCode = text(raw?.postalCode, 32), country = text(raw?.country, 2);
  if (!raw || !name || !line1 || !city || !postalCode || !country) return null;
  return {
    name,
    address: formatConfirmedDeliveryAddress({
      name, line1, city, postalCode, country,
      ...(text(raw.line2) ? { line2: text(raw.line2)! } : {}),
      ...(text(raw.region, 64) ? { region: text(raw.region, 64)! } : {}),
    }),
  };
}

/** The found order, as the page shows it; null when Commerce's answer is not the order it promised. */
export function orderLookupView(value: unknown): OrderLookupView | null {
  const order = record(value);
  if (!order || !Number.isSafeInteger(order.number) || (order.status !== "processing" && order.status !== "completed") ||
      !Array.isArray(order.lines) || order.lines.length > 100) return null;
  const choices = Array.isArray(order.choices) ? order.choices.map(record) : [];
  const lines: OrderLookupView["lines"][number][] = [];
  for (const entry of order.lines) {
    const line = record(entry);
    const id = text(line?.catalogItemId), name = text(line?.name), unit = money(line?.unitPrice);
    const quantity = line?.quantity;
    if (!id || !name || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    const minor = unit ? Number(unit.minor) * quantity : NaN;
    const choice = choices.find((item) => item?.catalogItemId === id);
    // The same option text the store's Orders page and emails use, such as "Size: M · Colour: Red".
    const options = Array.isArray(choice?.selections)
      ? choice.selections.map(record).flatMap((pick) => {
          const label = text(pick?.optionLabel), chosen = text(pick?.valueLabel);
          return label && chosen ? [`${label}: ${chosen}`] : [];
        }).join(" · ")
      : "";
    lines.push({
      id,
      text: `${name} × ${quantity}`,
      options: options || null,
      amount: unit && Number.isSafeInteger(minor) ? amount({ currency: unit.currency, minor: String(minor) }) ?? "" : "",
    });
  }
  const pricing = record(order.pricing);
  const shipping = record(pricing?.shipping);
  const discount = money(pricing?.couponDiscount);
  const totals = ([
    ["Subtotal", amount(money(pricing?.merchandiseSubtotal))],
    ["Discount", discount && discount.minor !== "0" ? amount(discount, { minus: true }) : null],
    ["Shipping", amount(money(shipping?.charge), { free: true })],
    ["Total", amount(money(order.total))],
  ] as const).flatMap(([label, shown]) => shown ? [{ label, amount: shown }] : []);
  const shipTo = delivery(order.delivery);
  const completed = order.status === "completed" ? record(order.completed) : null;
  return {
    number: String(order.number),
    status: order.status === "completed" ? "Completed" : "Processing",
    paidOn: paidOn(order.paidAt),
    lines,
    totals,
    recipient: shipTo?.name ?? null,
    address: shipTo?.address ?? null,
    carrier: text(completed?.carrier),
    tracking: text(completed?.tracking),
  };
}

function unwrap(body: unknown): unknown {
  const raw = record(body);
  return raw?.success === true ? raw.data : body;
}

function failure(code: LookupCode, form: OrderLookupForm): OrderLookupOutcome {
  return { ok: false, code, message: ORDER_LOOKUP_TEXT[code], form };
}

type PublicDispatcher = (pluginId: string, method: string, path: string, request: Request) => Promise<unknown>;

/** Ask Commerce for the one order behind a posted order number and checkout email. */
export async function lookUpOrder(ctx: Pick<ServerCartContext, "locals" | "request" | "url">): Promise<OrderLookupOutcome> {
  const empty = { orderNumber: "", email: "" };
  const posted = sameStoreRequest(ctx) ? await readBoundedForm(ctx.request, MAX_FORM_BYTES) : null;
  if (!posted) return failure("UNAVAILABLE", empty);
  const field = (name: string) => {
    const value = posted.get(name);
    return typeof value === "string" ? value.trim().slice(0, 254) : "";
  };
  const form = { orderNumber: field("orderNumber"), email: field("email") };
  if (!form.orderNumber || !form.email) return failure("INVALID_INPUT", form);
  const runtime = ctx.locals.emdash as unknown as { handlePublicPluginApiRoute?: PublicDispatcher } | undefined;
  if (typeof runtime?.handlePublicPluginApiRoute !== "function") return failure("UNAVAILABLE", form);
  const origin = trustedStoreOrigin(ctx);
  let answer: unknown;
  try {
    const raw = await runtime.handlePublicPluginApiRoute(COMMERCE_REGISTRY_RUNTIME_ID, "POST", ROUTE,
      new Request(new URL(`/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/${ROUTE}`, origin), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", origin, "sec-fetch-site": "same-origin" },
        body: JSON.stringify(form),
      }));
    const body = JSON.stringify(raw);
    if (typeof body !== "string" || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      return failure("UNAVAILABLE", form);
    }
    answer = unwrap(JSON.parse(body));
  } catch {
    return failure("UNAVAILABLE", form);
  }
  const result = record(answer);
  if (result?.ok === true) {
    const order = orderLookupView(result.order);
    return order ? { ok: true, order } : failure("UNAVAILABLE", form);
  }
  const code = record(result?.error)?.code;
  return failure(typeof code === "string" && code in ORDER_LOOKUP_TEXT && code !== "UNAVAILABLE"
    ? code as LookupCode
    : "UNAVAILABLE", form);
}
