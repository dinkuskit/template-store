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

/** Names the playground store a page came from; set only by the playground Worker. */
export const PLAYGROUND_STORE_META = "dinkus-playground-store";
const PLAYGROUND_STORE_STORAGE_KEY = "dinkus.playground-store";
/** Browser state that belongs to one playground store: its cart, checkout attempt and shopper sign-in. */
const PLAYGROUND_STORE_KEYS = ["dinkus.guest-cart.v1", "dinkus.guest-checkout.v1", "dinkus.shopper-session.v1"];

/**
 * Each playground session is a fresh store with new product ids, but the cart
 * lives in the browser. When the page names a different playground store than
 * the one this browser last saw, its cart, checkout attempt and sign-in belong
 * to a store that is gone, so they are cleared.
 */
export function forgetEndedPlaygroundStore(storage: Storage): void {
  try {
    if (typeof document === "undefined") return;
    const store = document.querySelector(`meta[name="${PLAYGROUND_STORE_META}"]`)?.getAttribute("content");
    if (!store || storage.getItem(PLAYGROUND_STORE_STORAGE_KEY) === store) return;
    for (const key of PLAYGROUND_STORE_KEYS) storage.removeItem(key);
    storage.setItem(PLAYGROUND_STORE_STORAGE_KEY, store);
  } catch {
    // Outside the playground nothing is tagged; a storage error here must not hide the cart.
  }
}

export function readBrowserGuestCartStorage(): GuestCartStoragePort | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    const storage = globalThis.localStorage;
    storage.getItem("dinkus.guest-cart.probe");
    forgetEndedPlaygroundStore(storage);
    return storage;
  } catch {
    return null;
  }
}
