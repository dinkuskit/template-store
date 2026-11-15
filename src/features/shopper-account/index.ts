import { COMMERCE_RUNTIME_ID } from "../commerce-profile/selected.js";
import {
  GUEST_CART_MAX_LINES,
  isSafeGuestCartProductId,
  isSafeGuestCartThumbnailSrc,
  type GuestCartPublicThumbnail,
} from "../guest-cart/index.js";

export const SHOPPER_SESSION_STORAGE_KEY = "dinkus.shopper-session.v1";
export const SHOPPER_SESSION_HEADER = "x-commerce-customer-session";
export const SHOPPER_CATALOG_SNAPSHOT_BATCH_SIZE = GUEST_CART_MAX_LINES;
export const DEMO_SHOPPER_EMAIL = "shopper@example.com";
export const DEMO_SHOPPER_ORDER_ID = "ord_demo_shopper_1001";
export const DEMO_SHOPPER_ORDER_NUMBER = 1001;

export const SHOPPER_SIGN_IN_START_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-in/start`;
export const SHOPPER_SIGN_IN_VERIFY_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-in/verify`;
export const SHOPPER_SIGN_OUT_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-out`;
export const SHOPPER_ORDERS_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/orders`;
export const SHOPPER_PROFILE_ENDPOINT =
  `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/profile`;
export const PLAYGROUND_DEMO_SESSION_ENDPOINT = "/api/account/demo-session";
export const SHOPPER_CATALOG_SNAPSHOT_ENDPOINT = "/api/guest-cart/snapshot";

const MAX_SESSION_TOKEN_LENGTH = 256;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,96}\.[A-Za-z0-9_-]{16,128}$/u;

export type StoredShopperSession = Readonly<{
  sessionId: string;
  sessionToken: string;
  email: string;
  expiresAt: number;
}>;

export interface ShopperSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ShopperDeliveryAddress = Readonly<{
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}>;

export type ShopperProfile = Readonly<{
  email: string;
  phone: string | null;
  delivery: ShopperDeliveryAddress | null;
}>;

export type ShopperOrderOptionSelection = Readonly<{
  optionId?: string;
  optionLabel: string;
  valueId?: string;
  valueLabel: string;
}>;

export type ShopperOrderVariantChoice = Readonly<{
  productId?: string;
  catalogItemId: string;
  selections: readonly ShopperOrderOptionSelection[];
  fulfillment?: "physical" | "digital";
}>;

export type ShopperOrderLine = Readonly<{
  catalogItemId: string;
  name: string;
  quantity: number;
  unitPrice: Readonly<{ currency: string; minor: string }>;
  sku?: string | null;
  variant?: string | null;
  variantLabel?: string | null;
  options?: readonly ShopperOrderOptionSelection[] | null;
  selections?: readonly ShopperOrderOptionSelection[] | null;
  fulfillment?: "physical" | "digital" | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  image?: string | Readonly<{ src?: string | null; alt?: string | null }> | null;
}>;

export type ShopperOrderItem = Readonly<{
  orderId: string;
  receiptId: string;
  number: number | null;
  status: "processing" | "completed";
  paidAt: string | null;
  total: Readonly<{ currency: string; minor: string }>;
  lines: readonly ShopperOrderLine[];
  choices?: readonly ShopperOrderVariantChoice[];
  variantSelections?: readonly ShopperOrderVariantChoice[];
  delivery: ShopperDeliveryAddress | null;
  phone: string | null;
  /** Commerce's current completion; older account projections may omit it. */
  completed?: Readonly<{ at: string; carrier?: string; tracking?: string }> | null;
}>;

export type ShopperOrderCatalogSnapshot = Readonly<{
  id: string;
  found: boolean;
  name?: string;
  sku?: string;
  fulfillment?: "physical" | "digital";
  variant?: string | null;
  variantLabel?: string | null;
  options?: readonly ShopperOrderOptionSelection[] | null;
  thumbnail?: GuestCartPublicThumbnail | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  image?: string | Readonly<{ src?: string | null; alt?: string | null }> | null;
}>;

export type ShopperOrderLinePresentation = Readonly<{
  catalogItemId: string;
  name: string;
  quantity: number;
  unitPriceText: string;
  thumbnailUrl: string | null;
  thumbnailAlt: string;
  sku: string | null;
  variantLabel: string | null;
  fulfillmentLabel: string | null;
}>;

type SeededDemoMetadata = Readonly<{
  sku: string;
  thumbnailUrl: string;
  variantLabel: string;
  fulfillment: "physical" | "digital";
}>;

/**
 * Exact seeded playground/demo product metadata (`demo-hosted-*` only, when
 * `playgroundMode === true`). Ordinary merchant or shipping orders never read
 * this table, never guess sizes from SKU suffixes, and never infer artwork
 * from product names.
 */
const SEEDED_DEMO_ORDER_LINE_METADATA: Readonly<Record<string, SeededDemoMetadata>> = {
  "demo-hosted-shirt": {
    sku: "DEMO-HOSTED-SHIRT",
    thumbnailUrl: "/images/products/shirt.svg",
    variantLabel: "Heavyweight Cotton · Regular Fit",
    fulfillment: "physical",
  },
  "demo-hosted-cap": {
    sku: "DEMO-HOSTED-CAP",
    thumbnailUrl: "/images/products/cap.svg",
    variantLabel: "6-Panel Canvas · One Size",
    fulfillment: "physical",
  },
  "demo-hosted-hoodie": {
    sku: "DEMO-HOSTED-HOODIE",
    thumbnailUrl: "/images/products/hoodie.svg",
    variantLabel: "Fleece Pullover · Standard",
    fulfillment: "physical",
  },
  "demo-hosted-hoodie-s": {
    sku: "DEMO-HOSTED-HOODIE-S",
    thumbnailUrl: "/images/products/hoodie.svg",
    variantLabel: "Size: Small",
    fulfillment: "physical",
  },
  "demo-hosted-hoodie-m": {
    sku: "DEMO-HOSTED-HOODIE-M",
    thumbnailUrl: "/images/products/hoodie.svg",
    variantLabel: "Size: Medium",
    fulfillment: "physical",
  },
  "demo-hosted-hoodie-l": {
    sku: "DEMO-HOSTED-HOODIE-L",
    thumbnailUrl: "/images/products/hoodie.svg",
    variantLabel: "Size: Large",
    fulfillment: "physical",
  },
  "demo-hosted-mug": {
    sku: "DEMO-HOSTED-MUG",
    thumbnailUrl: "/images/products/mug.svg",
    variantLabel: "Stoneware · 12 oz",
    fulfillment: "physical",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeThumbnailUrl(value: unknown): string | null {
  if (isRecord(value)) {
    return safeThumbnailUrl(value.src);
  }
  const candidate = cleanText(value);
  if (!candidate || !isSafeGuestCartThumbnailSrc(candidate)) return null;
  return candidate;
}

function formatOptionSelections(
  selections: readonly ShopperOrderOptionSelection[] | null | undefined,
): string | null {
  if (!Array.isArray(selections) || selections.length === 0) return null;
  const parts: string[] = [];
  for (const item of selections) {
    if (!isRecord(item)) continue;
    const optionLabel = cleanText(item.optionLabel);
    const valueLabel = cleanText(item.valueLabel);
    if (optionLabel && valueLabel) {
      parts.push(`${optionLabel}: ${valueLabel}`);
    } else if (valueLabel) {
      parts.push(valueLabel);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function lookupSeededDemoMetadata(
  playgroundMode: boolean | undefined,
  ...keys: Array<string | null | undefined>
): SeededDemoMetadata | null {
  if (!playgroundMode) return null;
  for (const rawKey of keys) {
    const normalized = cleanText(rawKey)?.toLowerCase();
    if (!normalized) continue;
    const direct = SEEDED_DEMO_ORDER_LINE_METADATA[normalized];
    if (direct) return direct;
  }
  return null;
}

export function collectOrderCatalogSnapshotBatches(
  orders: readonly ShopperOrderItem[],
  batchSize = SHOPPER_CATALOG_SNAPSHOT_BATCH_SIZE,
): readonly (readonly string[])[] {
  const safeBatchSize = Math.max(1, Math.min(SHOPPER_CATALOG_SNAPSHOT_BATCH_SIZE, Math.trunc(batchSize)));
  const seen = new Set<string>();
  for (const order of orders) {
    for (const line of order.lines) {
      const id = line.catalogItemId?.trim();
      if (id && isSafeGuestCartProductId(id)) {
        seen.add(id);
      }
    }
  }
  const allIds = [...seen];
  const batches: string[][] = [];
  for (let index = 0; index < allIds.length; index += safeBatchSize) {
    batches.push(allIds.slice(index, index + safeBatchSize));
  }
  return batches;
}

export function resolveOrderLinePresentation(
  line: ShopperOrderLine,
  context?: {
    order?: Pick<ShopperOrderItem, "choices" | "variantSelections"> | null;
    snapshot?: ShopperOrderCatalogSnapshot | null;
    playgroundMode?: boolean;
  },
): ShopperOrderLinePresentation {
  const snapshot = context?.snapshot?.found ? context.snapshot : null;
  const orderChoices = context?.order?.choices ?? context?.order?.variantSelections ?? [];
  const matchingChoice = Array.isArray(orderChoices)
    ? orderChoices.find((choice) => isRecord(choice) && choice.catalogItemId === line.catalogItemId)
    : undefined;

  const seededDemo = lookupSeededDemoMetadata(
    context?.playgroundMode,
    line.catalogItemId,
    matchingChoice?.productId,
    line.sku,
    snapshot?.sku,
    snapshot?.id,
  );

  const sku =
    cleanText(line.sku) ??
    cleanText(snapshot?.sku) ??
    seededDemo?.sku ??
    null;

  const variantLabel =
    cleanText(line.variantLabel) ??
    cleanText(line.variant) ??
    formatOptionSelections(line.options ?? line.selections) ??
    formatOptionSelections(matchingChoice?.selections) ??
    cleanText(snapshot?.variantLabel) ??
    cleanText(snapshot?.variant) ??
    formatOptionSelections(snapshot?.options) ??
    seededDemo?.variantLabel ??
    null;

  const rawFulfillment =
    line.fulfillment ??
    matchingChoice?.fulfillment ??
    snapshot?.fulfillment ??
    seededDemo?.fulfillment ??
    null;
  const fulfillmentLabel =
    rawFulfillment === "physical"
      ? "Physical"
      : rawFulfillment === "digital"
        ? "Digital"
        : null;

  const explicitThumb =
    safeThumbnailUrl(line.thumbnailUrl) ??
    safeThumbnailUrl(line.imageUrl) ??
    safeThumbnailUrl(line.image) ??
    safeThumbnailUrl(snapshot?.thumbnail) ??
    safeThumbnailUrl(snapshot?.thumbnailUrl) ??
    safeThumbnailUrl(snapshot?.imageUrl) ??
    safeThumbnailUrl(snapshot?.image);

  const thumbnailUrl = explicitThumb ?? seededDemo?.thumbnailUrl ?? null;

  const explicitAlt =
    (isRecord(line.image) ? cleanText(line.image.alt) : null) ??
    cleanText(snapshot?.thumbnail?.alt) ??
    (isRecord(snapshot?.image) ? cleanText(snapshot.image.alt) : null);

  return {
    catalogItemId: line.catalogItemId,
    name: line.name,
    quantity: line.quantity,
    unitPriceText: formatOrderMoney(line.unitPrice),
    thumbnailUrl,
    thumbnailAlt: explicitAlt ?? `${line.name} thumbnail`,
    sku,
    variantLabel,
    fulfillmentLabel,
  };
}

export function isValidShopperSessionToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_TOKEN_LENGTH &&
    SESSION_TOKEN_PATTERN.test(value)
  );
}

export function readBrowserShopperStorage(): ShopperSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredShopperSession(
  storage: ShopperSessionStorage | null = readBrowserShopperStorage(),
  nowSeconds = Math.floor(Date.now() / 1000),
): StoredShopperSession | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SHOPPER_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const { sessionId, sessionToken, email, expiresAt } = parsed;
    if (
      typeof sessionId !== "string" ||
      sessionId.trim().length < 8 ||
      !isValidShopperSessionToken(sessionToken) ||
      typeof email !== "string" ||
      !email.includes("@") ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt)
    ) {
      return null;
    }
    if (expiresAt <= nowSeconds) {
      clearStoredShopperSession(storage);
      return null;
    }
    return {
      sessionId,
      sessionToken,
      email: email.trim().toLowerCase(),
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function saveStoredShopperSession(
  session: StoredShopperSession,
  storage: ShopperSessionStorage | null = readBrowserShopperStorage(),
): boolean {
  if (!storage || !isValidShopperSessionToken(session.sessionToken)) return false;
  try {
    storage.setItem(
      SHOPPER_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        email: session.email.trim().toLowerCase(),
        expiresAt: session.expiresAt,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearStoredShopperSession(
  storage: ShopperSessionStorage | null = readBrowserShopperStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(SHOPPER_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors in restricted browser contexts.
  }
}

export function formatOrderMoney(money: Readonly<{ currency: string; minor: string }> | undefined | null): string {
  if (!money || money.currency !== "USD") return "$0.00";
  const minor = Number(money.minor);
  if (!Number.isSafeInteger(minor) || minor < 0) return "$0.00";
  return `$${(minor / 100).toFixed(2)}`;
}

/** Only definitive authentication failure invalidates a browser capability.
 * The SDK transports Commerce business denials inside an HTTP 200 envelope;
 * callers must unwrap it first. Other business, transport and server errors
 * do not establish that the session has been revoked.
 */
export function isShopperSessionDenied(status: number, body: unknown): boolean {
  return status === 401 || (
    status === 200 && isRecord(body) && body.ok === false &&
    isRecord(body.error) && body.error.code === "SESSION_DENIED"
  );
}

export function unwrapPluginEnvelope(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.success === "boolean") {
    if (payload.success && isRecord(payload.data)) {
      return payload.data;
    }
    if (!payload.success && isRecord(payload.error)) {
      return { ok: false, error: payload.error };
    }
  }
  return payload;
}
