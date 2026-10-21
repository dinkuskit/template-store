import { COMMERCE_RUNTIME_ID } from "../commerce-profile/selected.js";

export const SHOPPER_SESSION_STORAGE_KEY = "dinkus.shopper-session.v1";
export const SHOPPER_SESSION_HEADER = "x-commerce-customer-session";
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

export type ShopperOrderLine = Readonly<{
  catalogItemId: string;
  name: string;
  quantity: number;
  unitPrice: Readonly<{ currency: string; minor: string }>;
}>;

export type ShopperOrderItem = Readonly<{
  orderId: string;
  receiptId: string;
  number: number | null;
  status: "processing" | "completed";
  paidAt: string | null;
  total: Readonly<{ currency: string; minor: string }>;
  lines: readonly ShopperOrderLine[];
  delivery: ShopperDeliveryAddress | null;
  phone: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
