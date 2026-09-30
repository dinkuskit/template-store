export const GUEST_CART_STORAGE_KEY = "dinkus.guest-cart.v1";
export const GUEST_CART_VERSION = 1;
export const GUEST_CART_MAX_LINES = 40;
export const GUEST_CART_MAX_QUANTITY = 99;
export const GUEST_CART_MAX_ID_LENGTH = 128;
export const GUEST_CART_MAX_RAW_LENGTH = 8192;

export type GuestCartLine = Readonly<{
  id: string;
  quantity: number;
}>;

export type GuestCartIntent = Readonly<{
  version: typeof GUEST_CART_VERSION;
  lines: readonly GuestCartLine[];
}>;

export type GuestCartReadNotice =
  | "rejected-malformed"
  | "storage-unavailable"
  | "storage-write-failed";

export type GuestCartMutationResult = Readonly<{
  intent: GuestCartIntent;
  accepted: boolean;
  reason: string | null;
}>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function emptyGuestCartIntent(): GuestCartIntent {
  return { version: GUEST_CART_VERSION, lines: [] };
}

export function isSafeGuestCartProductId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > GUEST_CART_MAX_ID_LENGTH) return false;
  if (value.includes("..") || value.includes("/") || value.includes("\\")) return false;
  return SAFE_ID.test(value);
}

export function isSafeGuestCartQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= GUEST_CART_MAX_QUANTITY
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGuestCartIntent(value: unknown): GuestCartIntent | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("version") || !keys.includes("lines")) {
    return null;
  }
  if (value.version !== GUEST_CART_VERSION || !Array.isArray(value.lines)) {
    return null;
  }
  if (value.lines.length > GUEST_CART_MAX_LINES) return null;
  const lines: GuestCartLine[] = [];
  const seen = new Set<string>();
  for (const entry of value.lines) {
    if (!isPlainObject(entry)) return null;
    const entryKeys = Object.keys(entry);
    if (entryKeys.length !== 2 || !entryKeys.includes("id") || !entryKeys.includes("quantity")) {
      return null;
    }
    if (!isSafeGuestCartProductId(entry.id) || !isSafeGuestCartQuantity(entry.quantity)) {
      return null;
    }
    if (seen.has(entry.id)) return null;
    seen.add(entry.id);
    lines.push({ id: entry.id, quantity: entry.quantity });
  }
  return { version: GUEST_CART_VERSION, lines };
}

export function parseGuestCartQuantityInput(value: string): number | null {
  if (!/^[1-9][0-9]*$/u.test(value)) return null;
  const quantity = Number(value);
  return isSafeGuestCartQuantity(quantity) ? quantity : null;
}

export function addGuestCartLine(
  intent: GuestCartIntent,
  id: string,
  quantity = 1,
): GuestCartMutationResult {
  if (!isSafeGuestCartProductId(id) || !isSafeGuestCartQuantity(quantity)) {
    return { intent, accepted: false, reason: "That product cannot be added to the cart." };
  }
  const existing = intent.lines.find((line) => line.id === id);
  if (!existing && intent.lines.length >= GUEST_CART_MAX_LINES) {
    return { intent, accepted: false, reason: "The cart is full." };
  }
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > GUEST_CART_MAX_QUANTITY) {
    return {
      intent,
      accepted: false,
      reason: `Quantity must be a whole number from 1 to ${GUEST_CART_MAX_QUANTITY}.`,
    };
  }
  const lines = existing
    ? intent.lines.map((line) => (line.id === id ? { id, quantity: nextQuantity } : line))
    : [...intent.lines, { id, quantity: nextQuantity }];
  return { intent: { version: GUEST_CART_VERSION, lines }, accepted: true, reason: null };
}

export function setGuestCartLineQuantity(
  intent: GuestCartIntent,
  id: string,
  quantity: number,
): GuestCartMutationResult {
  if (!isSafeGuestCartProductId(id) || !intent.lines.some((line) => line.id === id)) {
    return { intent, accepted: false, reason: "That cart line is no longer present." };
  }
  if (!isSafeGuestCartQuantity(quantity)) {
    return {
      intent,
      accepted: false,
      reason: `Quantity must be a whole number from 1 to ${GUEST_CART_MAX_QUANTITY}.`,
    };
  }
  return {
    intent: {
      version: GUEST_CART_VERSION,
      lines: intent.lines.map((line) => (line.id === id ? { id, quantity } : line)),
    },
    accepted: true,
    reason: null,
  };
}

export function removeGuestCartLine(
  intent: GuestCartIntent,
  id: string,
): GuestCartMutationResult {
  if (!isSafeGuestCartProductId(id) || !intent.lines.some((line) => line.id === id)) {
    return { intent, accepted: false, reason: "That cart line is no longer present." };
  }
  return {
    intent: {
      version: GUEST_CART_VERSION,
      lines: intent.lines.filter((line) => line.id !== id),
    },
    accepted: true,
    reason: null,
  };
}

export function guestCartItemCount(intent: GuestCartIntent): number {
  return intent.lines.reduce((total, line) => total + line.quantity, 0);
}
