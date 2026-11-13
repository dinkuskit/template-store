import type {
  GuestCheckoutDelivery,
  GuestCheckoutOrderLine,
  GuestCheckoutProjection,
} from "./checkout-protocol.js";
import { isSafeOrderLineImageUrl } from "./checkout-protocol.js";

/** The thank-you page's order, drawn on the server from Commerce's paid order (template-thank-you-server-20261113). */
export type ConfirmedOrderView = Readonly<{
  orderNumber: string;
  test: boolean;
  lines: readonly Readonly<{
    id: string;
    sku: string | null;
    text: string;
    variant: string | null;
    amount: string;
    thumbnail: Readonly<{ src: string; alt: string }> | null;
  }>[];
  totals: readonly Readonly<{ label: string; amount: string }>[];
  email: string | null;
  recipient: string | null;
  address: string | null;
  billingAddress: string | null;
  shippingMethod: string | null;
}>;

export function formatConfirmedDeliveryAddress(delivery: GuestCheckoutDelivery): string {
  const locality = [delivery.city, delivery.region, delivery.postalCode].filter(Boolean).join(" ");
  return [delivery.line1, delivery.line2, locality, delivery.country].filter(Boolean).join(", ");
}

export function formatCheckoutMoneyValue(value: { currency: string; minor: string }): string | null {
  const minor = Number(value.minor);
  if (!Number.isSafeInteger(minor)) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(minor / 100);
  } catch {
    return `${value.currency} ${(minor / 100).toFixed(2)}`;
  }
}

function money(value: unknown, freeShipping = false): string | null {
  if (!value || typeof value !== "object") return null;
  const { minor, currency } = value as Record<string, unknown>;
  if (typeof minor !== "string" || !/^-?\d+$/u.test(minor) || typeof currency !== "string") return null;
  if (freeShipping && minor === "0") return "Free";
  return formatCheckoutMoneyValue({ currency, minor });
}

function lineThumbnail(line: GuestCheckoutOrderLine): ConfirmedOrderView["lines"][number]["thumbnail"] {
  return isSafeOrderLineImageUrl(line.imageUrl)
    ? { src: line.imageUrl.trim(), alt: line.imageAlt ?? `${line.name ?? line.id} thumbnail` }
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The paid order's view, or null while Commerce has no paid order for this checkout. */
export function confirmedOrderView(checkout: GuestCheckoutProjection): ConfirmedOrderView | null {
  const order = checkout.state === "paid" ? checkout.order : null;
  if (!order || !checkout.attemptId) return null;
  const pricing = record(checkout.pricing);
  const shipping = record(pricing?.shipping);
  const delivery = order.delivery ?? order.contact?.delivery ?? checkout.delivery ?? checkout.contact?.delivery ?? null;
  const billing = order.contact?.billing ?? checkout.contact?.billing ?? null;
  const shippingCharge = money(shipping?.charge);
  const shippingMethod = order.shippingMethod ?? checkout.shippingMethod ??
    (shipping?.mode === "free" ? "Free shipping"
      : shipping?.mode === "flat" ? (shippingCharge ? `Flat rate (${shippingCharge})` : "Flat rate shipping")
      : delivery && shippingCharge ? (record(shipping?.charge)?.minor === "0" ? "Free shipping" : `Standard shipping (${shippingCharge})`)
      : null);
  const totals = ([
    ["Subtotal", money(pricing?.merchandiseSubtotal)],
    ["Shipping", money(shipping?.charge, true)],
    ["Tax", money(pricing?.tax ?? pricing?.taxTotal)],
    ["Total", money(order.total ?? checkout.total)],
  ] as const).flatMap(([label, amount]) => amount ? [{ label, amount }] : []);
  return {
    orderNumber: order.orderId.replace(/^order:/u, ""),
    test: order.test === true,
    lines: order.lines.map((line) => {
      const unit = line.unitPrice && /^-?\d+$/u.test(line.unitPrice.minor) ? Number(line.unitPrice.minor) : NaN;
      const minor = Number.isSafeInteger(unit) && Number.isSafeInteger(unit * line.quantity) ? unit * line.quantity : null;
      return {
        id: line.id,
        sku: line.sku ?? null,
        text: `${line.name ?? line.id} × ${line.quantity}`,
        variant: line.variant ?? null,
        amount: minor === null || !line.unitPrice ? "" : formatCheckoutMoneyValue({ currency: line.unitPrice.currency, minor: String(minor) }) ?? "",
        thumbnail: lineThumbnail(line),
      };
    }),
    totals,
    email: order.contact?.email ?? checkout.contact?.email ?? null,
    recipient: delivery?.name ?? null,
    address: delivery ? formatConfirmedDeliveryAddress(delivery) : null,
    billingAddress: billing ? `${billing.name}, ${formatConfirmedDeliveryAddress(billing)}` : null,
    shippingMethod,
  };
}
