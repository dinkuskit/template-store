import { parseGuestCartIntent, type GuestCartLine } from "./intent.js";
import { isSafeGuestCartThumbnailSrc } from "./present.js";

export const GUEST_CHECKOUT_CAPABILITY_HEADER = "x-commerce-guest-capability";
export { COMMERCE_RUNTIME_ID as COMMERCE_REGISTRY_RUNTIME_ID } from "../commerce-profile/selected.js";
export const GUEST_CHECKOUT_PROJECTION_SCHEMA =
  "dinkuskit.commerce.guest-checkout-projection/v1";

const MAX_CAPABILITY_LENGTH = 512;
const MAX_ATTEMPT_ID_LENGTH = 256;

export type GuestCheckoutOrderLine = GuestCartLine & Readonly<{
  name?: string;
  variant?: string;
  imageUrl?: string;
  imageAlt?: string;
  sku?: string;
  unitPrice?: Readonly<{ currency: string; minor: string }>;
}>;

export type GuestCheckoutMoney = Readonly<{ currency: string; minor: string }>;

export type GuestCheckoutDelivery = Readonly<{
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}>;

export type GuestCheckoutContact = Readonly<{
  email: string;
  delivery?: GuestCheckoutDelivery;
  /** A full copy, even when it equals delivery (Commerce commerce-billing-address-001). */
  billing?: GuestCheckoutDelivery;
}>;

export type GuestCheckoutProjection = Readonly<{
  schema: typeof GUEST_CHECKOUT_PROJECTION_SCHEMA;
  state: "pending" | "paid" | "recoverable-failure" | "released-retry";
  attemptId: string | null;
  redirectUrl: string | null;
  order: Readonly<{
    orderId: string;
    receiptId: string;
    lines: readonly GuestCheckoutOrderLine[];
    total?: GuestCheckoutMoney;
    test?: boolean;
    contact?: GuestCheckoutContact;
    delivery?: GuestCheckoutDelivery;
    shippingMethod?: string;
  }> | null;
  contact?: GuestCheckoutContact;
  delivery?: GuestCheckoutDelivery;
  shippingMethod?: string;
  retryAfter: string | null;
  [key: string]: unknown;
}>;

export type GuestCheckoutWireResult =
  | Readonly<{
      ok: true;
      capabilityId: string;
      capability?: Readonly<{
        capabilityId: string;
        capability: string;
        retention: "json-body";
        header: typeof GUEST_CHECKOUT_CAPABILITY_HEADER;
      }>;
      checkout: GuestCheckoutProjection;
    }>
  | Readonly<{ ok: false; error: GuestCheckoutError }>;

export type GuestCheckoutCouponReason =
  | "not-found" | "not-started" | "expired" | "minimum-not-met"
  | "no-qualifying-items" | "used-up" | "try-later" | "not-applicable";

export type GuestCheckoutError = Readonly<{
  code: string;
  message: string;
  reason?: GuestCheckoutCouponReason;
  minimum?: Readonly<{ currency: "USD"; minor: string }>;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CAPABILITY_LENGTH &&
    /^[A-Za-z0-9._~-]+\.[A-Za-z0-9._~-]+$/u.test(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTEMPT_ID_LENGTH &&
    /^[A-Za-z0-9._~-]+$/u.test(value);
}

function safeCanonicalValue(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTEMPT_ID_LENGTH &&
    /^[A-Za-z0-9._~:-]+$/u.test(value);
}

function boundedText(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

export function isSafeOrderLineImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return isSafeGuestCartThumbnailSrc(value.trim());
}

function parseSafeImageUrl(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : isObject(value)
      ? (value.url ?? value.src)
      : undefined;
  if (!isSafeOrderLineImageUrl(raw)) return undefined;
  return raw.trim();
}

function parseSafeImageAlt(value: unknown): string | undefined {
  return boundedText(value, 256);
}

function formatSelectionItems(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length >= 2) {
      const option = boundedText(item[0], 80);
      const choice = boundedText(item[1], 120);
      if (option && choice) parts.push(`${option}: ${choice}`);
      else if (choice ?? option) parts.push((choice ?? option)!);
    } else if (isObject(item)) {
      const option = boundedText(item.optionLabel ?? item.option ?? item.name, 80);
      const choice = boundedText(item.valueLabel ?? item.value, 120);
      if (option && choice) parts.push(`${option}: ${choice}`);
      else if (choice ?? option) parts.push((choice ?? option)!);
    }
  }
  const formatted = parts.join(" / ");
  return formatted.length > 0 && formatted.length <= 256 ? formatted : undefined;
}

function parseVariantSelections(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const itemId = boundedText(entry.catalogItemId ?? entry.id, 128);
    const label = formatSelectionItems(entry.selections ?? entry.options);
    if (itemId && label && !map.has(itemId)) {
      map.set(itemId, label);
    }
  }
  return map;
}

function parseDelivery(value: unknown): GuestCheckoutDelivery | undefined {
  if (!isObject(value)) return undefined;
  const name = boundedText(value.name);
  const line1 = boundedText(value.line1);
  const line2 = boundedText(value.line2);
  const city = boundedText(value.city);
  const region = boundedText(value.region, 64);
  const postalCode = boundedText(value.postalCode, 32);
  const country = boundedText(value.country, 64);
  if (!name || !line1 || !city || !postalCode || !country) return undefined;
  return {
    name,
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    ...(region ? { region } : {}),
    postalCode,
    country,
  };
}

function parseContact(value: unknown, fallbackDelivery?: GuestCheckoutDelivery): GuestCheckoutContact | undefined {
  if (!isObject(value)) return undefined;
  const email = boundedText(value.email, 254);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return undefined;
  const delivery = parseDelivery(value.delivery ?? value.shippingAddress) ?? fallbackDelivery;
  const billing = parseDelivery(value.billing);
  return {
    email,
    ...(delivery ? { delivery } : {}),
    ...(billing ? { billing } : {}),
  };
}

function projectCheckout(value: unknown): GuestCheckoutProjection | null {
  if (!isObject(value) ||
      value.schema !== GUEST_CHECKOUT_PROJECTION_SCHEMA ||
      !["pending", "paid", "recoverable-failure", "released-retry"].includes(String(value.state)) ||
      (value.attemptId !== null && !safeId(value.attemptId)) ||
      (value.retryAfter !== null && !safeId(value.retryAfter)) ||
      (value.redirectUrl !== null && typeof value.redirectUrl !== "string")) {
    return null;
  }
  const topDelivery = parseDelivery(value.delivery ?? value.shippingAddress);
  const topContact = parseContact(value.contact ?? value.contactSnapshot, topDelivery) ??
    (typeof value.email === "string" ? parseContact({ email: value.email }, topDelivery) : undefined);
  const topShippingMethod = boundedText(value.shippingMethod, 160);
  let order: GuestCheckoutProjection["order"] = null;
  if (value.order !== null) {
    if (!isObject(value.order) ||
        !safeCanonicalValue(value.order.orderId) ||
        !safeCanonicalValue(value.order.receiptId)) return null;
    if (!Array.isArray(value.order.lines)) return null;
    const purchased = parseGuestCartIntent({ version: 1, lines: value.order.lines.map((line) =>
      isObject(line) ? { id: line.catalogItemId, quantity: line.quantity } : null) });
    if (!purchased || purchased.lines.length === 0) return null;
    const rawOrder = value.order as Record<string, unknown>;
    const rawLines = rawOrder.lines as unknown[];
    const variantByItem = parseVariantSelections(rawOrder.variantSelections ?? value.variantSelections);
    const lines = purchased.lines.map((line, index) => {
      const raw = rawLines[index];
      if (!isObject(raw)) return line;
      const name = typeof raw.name === "string" && raw.name.length <= 1024 ? raw.name : undefined;
      const directVariant = typeof raw.variant === "string" && raw.variant.length <= 256
        ? raw.variant
        : typeof raw.variantLabel === "string" && raw.variantLabel.trim() && raw.variantLabel.length <= 256
          ? raw.variantLabel.trim()
          : formatSelectionItems(raw.selections ?? raw.options);
      const variant = directVariant ?? variantByItem.get(line.id);
      const imageUrl = parseSafeImageUrl(raw.imageUrl ?? raw.thumbnailUrl ?? raw.image);
      const imageAlt = parseSafeImageAlt(raw.imageAlt ?? (isObject(raw.image) ? raw.image.alt : undefined));
      const sku = boundedText(raw.sku, 128);
      const unitPrice = isObject(raw.unitPrice) &&
        typeof raw.unitPrice.currency === "string" &&
        typeof raw.unitPrice.minor === "string" &&
        /^-?\d+$/u.test(raw.unitPrice.minor)
        ? { currency: raw.unitPrice.currency, minor: raw.unitPrice.minor }
        : undefined;
      return {
        ...line,
        ...(name ? { name } : {}),
        ...(variant ? { variant } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(imageAlt ? { imageAlt } : {}),
        ...(sku ? { sku } : {}),
        ...(unitPrice ? { unitPrice } : {}),
      };
    });
    const rawTotal = rawOrder.total;
    const total = isObject(rawTotal) &&
      typeof rawTotal.currency === "string" &&
      typeof rawTotal.minor === "string" &&
      /^-?\d+$/u.test(rawTotal.minor)
      ? { currency: rawTotal.currency, minor: rawTotal.minor }
      : undefined;
    const orderDelivery = parseDelivery(rawOrder.delivery ?? rawOrder.shippingAddress) ?? topDelivery;
    const orderContact = parseContact(rawOrder.contact ?? rawOrder.contactSnapshot, orderDelivery) ??
      (typeof rawOrder.email === "string" ? parseContact({ email: rawOrder.email }, orderDelivery) : undefined) ??
      topContact;
    const orderShippingMethod = boundedText(rawOrder.shippingMethod, 160) ?? topShippingMethod;
    order = {
      orderId: value.order.orderId,
      receiptId: value.order.receiptId,
      lines,
      ...(total ? { total } : {}),
      ...(typeof rawOrder.test === "boolean" ? { test: rawOrder.test } : {}),
      ...(orderContact ? { contact: orderContact } : {}),
      ...(orderDelivery && !orderContact?.delivery ? { delivery: orderDelivery } : {}),
      ...(orderShippingMethod ? { shippingMethod: orderShippingMethod } : {}),
    };
  }
  if (value.state === "paid" && !order) return null;
  if (value.state === "released-retry" &&
      (!value.attemptId || value.retryAfter !== value.attemptId)) return null;
  return {
    ...value,
    schema: GUEST_CHECKOUT_PROJECTION_SCHEMA,
    state: value.state as GuestCheckoutProjection["state"],
    attemptId: value.attemptId as string | null,
    redirectUrl: value.redirectUrl as string | null,
    order,
    ...(topContact ? { contact: topContact } : {}),
    ...(topDelivery && !topContact?.delivery ? { delivery: topDelivery } : {}),
    ...(topShippingMethod ? { shippingMethod: topShippingMethod } : {}),
    retryAfter: value.retryAfter as string | null,
  };
}


function unwrap(body: unknown): unknown {
  return isObject(body) && body.success === true ? body.data : body;
}

export function parseGuestCheckoutWireResult(body: unknown): GuestCheckoutWireResult | null {
  const errorValue = (value: unknown): GuestCheckoutError | null => {
    if (!isObject(value) || typeof value.code !== "string" || typeof value.message !== "string") return null;
    const reasons = ["not-found", "not-started", "expired", "minimum-not-met", "no-qualifying-items", "used-up", "try-later", "not-applicable"];
    if (value.reason !== undefined && (typeof value.reason !== "string" || !reasons.includes(value.reason))) return null;
    if (value.minimum !== undefined &&
        (!isObject(value.minimum) || value.minimum.currency !== "USD" ||
          typeof value.minimum.minor !== "string" || !/^-?[0-9]+$/u.test(value.minimum.minor))) return null;
    return {
      code: value.code,
      message: value.message,
      ...(value.reason === undefined ? {} : { reason: value.reason as GuestCheckoutCouponReason }),
      ...(value.minimum === undefined ? {} : { minimum: value.minimum as GuestCheckoutError["minimum"] }),
    };
  };
  if (isObject(body) && body.success === false && isObject(body.error) &&
      errorValue(body.error)) return { ok: false, error: errorValue(body.error)! };
  const value = unwrap(body);
  if (!isObject(value) || typeof value.ok !== "boolean") return null;
  if (!value.ok) {
    const error = errorValue(value.error);
    if (!error) return null;
    return { ok: false, error };
  }
  if (typeof value.capabilityId !== "string" || !safeId(value.capabilityId)) return null;
  const checkout = projectCheckout(value.checkout);
  if (!checkout) return null;
  if (value.capability !== undefined) {
    if (!isObject(value.capability) ||
        value.capability.capabilityId !== value.capabilityId ||
        !safeToken(value.capability.capability) ||
        !value.capability.capability.startsWith(`${value.capabilityId}.`) ||
        value.capability.retention !== "json-body" ||
        value.capability.header !== GUEST_CHECKOUT_CAPABILITY_HEADER) return null;
    return {
      ok: true,
      capabilityId: value.capabilityId,
      capability: {
        capabilityId: value.capabilityId,
        capability: value.capability.capability,
        retention: "json-body",
        header: GUEST_CHECKOUT_CAPABILITY_HEADER,
      },
      checkout,
    };
  }
  return { ok: true, capabilityId: value.capabilityId, checkout };
}
