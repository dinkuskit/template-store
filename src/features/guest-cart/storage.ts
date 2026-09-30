import {
  GUEST_CART_MAX_RAW_LENGTH,
  emptyGuestCartIntent,
  parseGuestCartIntent,
  type GuestCartIntent,
  type GuestCartReadNotice,
} from "./intent.js";

export interface GuestCartStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type GuestCartLoadResult = Readonly<{
  intent: GuestCartIntent;
  persisted: boolean;
  notice: GuestCartReadNotice | null;
}>;

export type GuestCartSaveResult = Readonly<{
  intent: GuestCartIntent;
  persisted: boolean;
  notice: GuestCartReadNotice | null;
}>;

export function loadGuestCartIntent(
  key: string,
  storage: GuestCartStoragePort | null,
): GuestCartLoadResult {
  if (!storage) {
    return { intent: emptyGuestCartIntent(), persisted: false, notice: "storage-unavailable" };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { intent: emptyGuestCartIntent(), persisted: false, notice: "storage-unavailable" };
  }
  if (raw === null || raw === "") {
    return { intent: emptyGuestCartIntent(), persisted: true, notice: null };
  }
  if (raw.length > GUEST_CART_MAX_RAW_LENGTH) {
    return { intent: emptyGuestCartIntent(), persisted: false, notice: "rejected-malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { intent: emptyGuestCartIntent(), persisted: false, notice: "rejected-malformed" };
  }
  const intent = parseGuestCartIntent(parsed);
  if (!intent) {
    return { intent: emptyGuestCartIntent(), persisted: false, notice: "rejected-malformed" };
  }
  return { intent, persisted: true, notice: null };
}

export function saveGuestCartIntent(
  key: string,
  intent: GuestCartIntent,
  storage: GuestCartStoragePort | null,
): GuestCartSaveResult {
  if (!storage) {
    return { intent, persisted: false, notice: "storage-unavailable" };
  }
  try {
    storage.setItem(key, JSON.stringify(intent));
    return { intent, persisted: true, notice: null };
  } catch {
    return { intent, persisted: false, notice: "storage-write-failed" };
  }
}

export function readBrowserGuestCartStorage(): GuestCartStoragePort | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    const storage = globalThis.localStorage;
    storage.getItem("dinkus.guest-cart.probe");
    return storage;
  } catch {
    return null;
  }
}
