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

type PlaygroundStore = { tag: string; started: number };

function pagePlaygroundStore(): PlaygroundStore | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector(`meta[name="${PLAYGROUND_STORE_META}"]`);
  const tag = meta?.getAttribute("content");
  const started = Number(meta?.getAttribute("data-started"));
  return tag && Number.isSafeInteger(started) ? { tag, started } : null;
}

function savedPlaygroundStore(storage: Storage): PlaygroundStore | null {
  try {
    const saved = JSON.parse(storage.getItem(PLAYGROUND_STORE_STORAGE_KEY) ?? "null") as Partial<PlaygroundStore> | null;
    return typeof saved?.tag === "string" && Number.isSafeInteger(saved.started) ? saved as PlaygroundStore : null;
  } catch {
    return null;
  }
}

/**
 * Each playground session is a fresh store with new product ids, but the cart
 * lives in the browser. When a page comes from a newer playground store than
 * the one this browser last saw, its cart, checkout attempt and sign-in belong
 * to a store that is gone, so they are cleared. The first tagged page only
 * records its store, so state it cannot prove stale is kept. A page from an
 * older store (a tab left open) gets no storage, so it can never clear or
 * overwrite the newer store's state; reloading it shows the current store.
 * Pages without a tag are never playground pages and always get storage.
 */
export function admitPlaygroundStoreStorage(storage: Storage): boolean {
  try {
    const page = pagePlaygroundStore();
    if (!page) return true;
    const saved = savedPlaygroundStore(storage);
    if (saved?.tag === page.tag) return true;
    if (saved && page.started <= saved.started) return false;
    if (saved) for (const key of PLAYGROUND_STORE_KEYS) storage.removeItem(key);
    storage.setItem(PLAYGROUND_STORE_STORAGE_KEY, JSON.stringify(page));
    return true;
  } catch {
    // A storage error here must not hide the cart.
    return true;
  }
}

export function readBrowserGuestCartStorage(): GuestCartStoragePort | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    const storage = globalThis.localStorage;
    storage.getItem("dinkus.guest-cart.probe");
    return admitPlaygroundStoreStorage(storage) ? storage : null;
  } catch {
    return null;
  }
}
