import { formatUsdMinor } from "../store-shell/price.js";
import { isSafeGuestCartProductId, type GuestCartIntent, type GuestCartReadNotice } from "./intent.js";

const availabilityLabels: Record<string, string> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "available-on-backorder": "Available on backorder",
  "low-stock": "Low stock",
  "availability-unavailable": "Availability unavailable",
};

export type GuestCartPublicPrice = Readonly<{
  listable: boolean;
  regularText: string | null;
  saleText: string | null;
  /** USD minor units the shopper pays for one unit; absent when unknown. */
  unitMinor?: string | null;
}>;

export type GuestCartPublicAvailability = Readonly<{
  status: string;
  sellable: boolean;
  listable: boolean;
}>;

export type GuestCartCatalogSnapshot =
  | Readonly<{ id: string; found: false }>
  | Readonly<{
      id: string;
      found: true;
      name: string;
      sku: string;
      fulfillment?: "physical" | "digital";
      price: GuestCartPublicPrice;
      availability: GuestCartPublicAvailability;
    }>;

export const GUEST_CHECKOUT_LABEL = "Checkout unavailable";
export const GUEST_CHECKOUT_REASON = "Checkout is not available yet.";
/** Shown when checkout is admitted but there is nothing to buy yet. */
export const GUEST_CHECKOUT_READY_LABEL = "Checkout";
export const GUEST_CHECKOUT_EMPTY_REASON = "Add products to your cart to check out.";

export type GuestCartLineReason =
  | "missing"
  | "unpriced"
  | "unavailable"
  | "snapshot-pending";

export type GuestCartLineView = Readonly<{
  id: string;
  quantity: number;
  name: string;
  sku: string | null;
  regularText: string | null;
  saleText: string | null;
  /** Unit price times quantity, or null when the unit amount is unknown. */
  lineTotalText: string | null;
  availabilityLabel: string | null;
  sellable: boolean;
  canCheckout: false;
  reasonCode: GuestCartLineReason | null;
  reason: string | null;
}>;

export type GuestCartView = Readonly<{
  lines: readonly GuestCartLineView[];
  /** Sum of line totals, or null when a line's amount is unknown. */
  subtotalText: string | null;
  empty: boolean;
  pending: boolean;
  retrying: boolean;
  snapshotError: string | null;
  storageNotice: string | null;
  checkoutLabel: string;
  checkoutReason: string;
  checkoutEnabled: boolean;
  needsDelivery: boolean;
}>;

const STORAGE_NOTICES: Record<GuestCartReadNotice, string> = {
  "rejected-malformed":
    "Saved cart data was rejected because it was malformed or unsafe. The cart started empty.",
  "storage-unavailable":
    "Browser storage is unavailable. Leave or reload this page and unsaved cart edits will be lost.",
  "storage-write-failed":
    "The cart could not be saved. Leave or reload this page and unsaved cart edits will be lost.",
};

export function storageNoticeText(notice: GuestCartReadNotice | null): string | null {
  return notice ? STORAGE_NOTICES[notice] : null;
}

export function snapshotErrorText(): string {
  return "We couldn't load the latest prices.";
}

export type GuestCartRetryControlInput = {
  snapshotError?: string | null;
  pending?: boolean;
  retrying?: boolean;
  retryPending?: boolean;
};

/**
 * The retry control is only offered after a failed price/stock refresh, and
 * remains visible and disabled while a retry is pending. It hides once a
 * refresh succeeds, and remains visible and enabled if a retry fails again.
 */
export function guestCartRetryControlState(view: GuestCartRetryControlInput): {
  hidden: boolean;
  disabled: boolean;
} {
  const isRetrying = Boolean(view.retrying ?? view.retryPending);
  const visible = Boolean(view.snapshotError || isRetrying);
  return {
    hidden: !visible,
    disabled: Boolean(view.pending || isRetrying),
  };
}

export function lineBlockReason(snapshot: GuestCartCatalogSnapshot | undefined): {
  reasonCode: GuestCartLineReason | null;
  reason: string | null;
  sellable: boolean;
} {
  if (!snapshot) {
    return {
      reasonCode: "snapshot-pending",
      reason: "Current product details are still loading.",
      sellable: false,
    };
  }
  if (!snapshot.found) {
    return {
      reasonCode: "missing",
      reason: "This product is no longer in the catalog and cannot be checked out.",
      sellable: false,
    };
  }
  if (!snapshot.price.listable) {
    return {
      reasonCode: "unpriced",
      reason: "This product does not have a current price and cannot be checked out.",
      sellable: false,
    };
  }
  if (!snapshot.availability.sellable) {
    return {
      reasonCode: "unavailable",
      reason: `${availabilityLabels[snapshot.availability.status] ?? "This product is not available"} and cannot be checked out.`,
      sellable: false,
    };
  }
  return { reasonCode: null, reason: null, sellable: true };
}

export function presentGuestCart(options: {
  intent: GuestCartIntent;
  snapshots?: readonly GuestCartCatalogSnapshot[] | null;
  pending?: boolean;
  retrying?: boolean;
  snapshotFailed?: boolean;
  storageNotice?: GuestCartReadNotice | null;
  checkoutAdmitted?: boolean;
}): GuestCartView {
  const byId = new Map((options.snapshots ?? []).map((snapshot) => [snapshot.id, snapshot]));
  const lines = options.intent.lines.map((line) => {
    const snapshot = options.snapshots ? byId.get(line.id) : undefined;
    const blocked = options.snapshotFailed && !snapshot
      ? {
          reasonCode: "snapshot-pending" as const,
          reason: "Current product details could not be loaded for this line.",
          sellable: false,
        }
      : lineBlockReason(snapshot);
    return {
      id: line.id,
      quantity: line.quantity,
      name: snapshot?.found ? snapshot.name : line.id,
      sku: snapshot?.found ? snapshot.sku : null,
      fulfillment: snapshot?.found ? snapshot.fulfillment ?? "physical" : "physical",
      regularText: snapshot?.found ? snapshot.price.regularText : null,
      saleText: snapshot?.found ? snapshot.price.saleText : null,
      lineTotalText: minorText(lineTotalMinor(snapshot, line.quantity)),
      availabilityLabel:
        snapshot?.found
          ? availabilityLabels[snapshot.availability.status] ?? snapshot.availability.status
          : null,
      sellable: blocked.sellable,
      canCheckout: false as const,
      reasonCode: blocked.reasonCode,
      reason: blocked.reason,
    };
  });
  const checkoutEnabled = options.checkoutAdmitted === true &&
    lines.length > 0 &&
    !options.pending &&
    !options.snapshotFailed &&
    lines.every((line) => line.sellable);
  const needsDelivery = lines.some((line) => line.fulfillment === "physical");
  // An empty cart on a store that takes checkouts says the cart is empty, not
  // that checkout is off.
  const emptyAdmitted = options.checkoutAdmitted === true && lines.length === 0 &&
    !options.pending && !options.snapshotFailed;
  return {
    lines,
    subtotalText: cartSubtotalText(options.intent.lines, options.snapshots ?? null),
    empty: lines.length === 0,
    pending: options.pending === true,
    retrying: options.retrying === true,
    snapshotError: options.snapshotFailed ? snapshotErrorText() : null,
    storageNotice: storageNoticeText(options.storageNotice ?? null),
    checkoutLabel: checkoutEnabled
      ? "Continue to secure checkout"
      : emptyAdmitted ? GUEST_CHECKOUT_READY_LABEL : GUEST_CHECKOUT_LABEL,
    checkoutReason: checkoutEnabled
      ? "Commerce will confirm the final amount and availability."
      : emptyAdmitted ? GUEST_CHECKOUT_EMPTY_REASON : GUEST_CHECKOUT_REASON,
    checkoutEnabled,
    needsDelivery,
  };
}

export function canAddCommerceProductToCart(product: {
  price: { listable: boolean };
  availability: { sellable: boolean };
}): boolean {
  return product.price.listable && product.availability.sellable;
}

const RETURN_QUERY_KEYS = new Set([
  "success",
  "canceled",
  "cancelled",
  "session_id",
  "sessionId",
  "payment_intent",
  "redirect_status",
  "checkout",
  "return",
]);

export function guestReturnQueryIsPresent(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of params.keys()) {
    if (RETURN_QUERY_KEYS.has(key)) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNIT_MINOR = /^(0|[1-9][0-9]{0,15})$/u;

function lineTotalMinor(
  snapshot: GuestCartCatalogSnapshot | undefined,
  quantity: number,
): bigint | null {
  if (!snapshot?.found || !snapshot.price.listable) return null;
  const unit = snapshot.price.unitMinor;
  if (typeof unit !== "string" || !UNIT_MINOR.test(unit)) return null;
  return BigInt(unit) * BigInt(quantity);
}

function minorText(minor: bigint | null): string | null {
  return minor === null ? null : formatUsdMinor(minor.toString());
}

/** Display subtotal; null unless every line has a known amount. */
function cartSubtotalText(
  lines: GuestCartIntent["lines"],
  snapshots: readonly GuestCartCatalogSnapshot[] | null,
): string | null {
  if (lines.length === 0 || !snapshots) return null;
  let total = 0n;
  for (const line of lines) {
    const minor = lineTotalMinor(snapshots.find((snapshot) => snapshot.id === line.id), line.quantity);
    if (minor === null) return null;
    total += minor;
  }
  return minorText(total);
}

function projectPublicPrice(value: unknown): GuestCartPublicPrice | null {
  if (!isPlainObject(value) || typeof value.listable !== "boolean") return null;
  if (value.regularText !== null && typeof value.regularText !== "string") return null;
  if (value.saleText !== null && typeof value.saleText !== "string") return null;
  return {
    listable: value.listable,
    regularText: value.regularText,
    saleText: value.saleText,
    ...(typeof value.unitMinor === "string" && UNIT_MINOR.test(value.unitMinor)
      ? { unitMinor: value.unitMinor }
      : {}),
  };
}

function projectPublicAvailability(value: unknown): {
  status: string;
  sellable: boolean;
  listable: boolean;
} | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.status !== "string" || value.status.length === 0) return null;
  if (typeof value.sellable !== "boolean" || typeof value.listable !== "boolean") return null;
  return {
    status: value.status,
    sellable: value.sellable,
    listable: value.listable,
  };
}

export function projectGuestCartCatalogSnapshot(value: unknown): GuestCartCatalogSnapshot | null {
  if (!isPlainObject(value) || !isSafeGuestCartProductId(value.id)) return null;
  if (value.found === false) {
    return { id: value.id, found: false };
  }
  if (value.found !== true) return null;
  if (typeof value.name !== "string" || typeof value.sku !== "string") return null;
  const price = projectPublicPrice(value.price);
  const availability = projectPublicAvailability(value.availability);
  if (!price || !availability) return null;
  const publicName = price.listable || availability.listable ? value.name : value.id;
  const publicSku = price.listable || availability.listable ? value.sku : "";
  return {
    id: value.id,
    found: true,
    name: publicName,
    sku: publicSku,
    fulfillment: value.fulfillment === "digital" ? "digital" : "physical",
    price,
    availability,
  };
}

export function projectGuestCartCatalogSnapshots(
  products: readonly unknown[],
): GuestCartCatalogSnapshot[] | null {
  const projected: GuestCartCatalogSnapshot[] = [];
  for (const product of products) {
    const snapshot = projectGuestCartCatalogSnapshot(product);
    if (!snapshot) return null;
    projected.push(snapshot);
  }
  return projected;
}

export function parseGuestCartSnapshotResponse(body: unknown): GuestCartCatalogSnapshot[] | null {
  if (!isPlainObject(body) || !Array.isArray(body.products)) return null;
  return projectGuestCartCatalogSnapshots(body.products);
}
