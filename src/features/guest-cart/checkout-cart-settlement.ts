import { GUEST_CART_STORAGE_KEY, type GuestCartIntent } from "./intent.js";
import { loadGuestCartIntent, saveGuestCartIntent } from "./storage.js";
import {
  GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY,
  checkoutCanConfirm,
  readGuestCheckoutRetention,
  type GuestCheckoutRetention,
  type GuestCheckoutRetentionStorage,
  type GuestCheckoutWireResult,
} from "./checkout-protocol.js";

async function fingerprint(intent: GuestCartIntent): Promise<string> {
  const canonical = JSON.stringify({ version: intent.version,
    lines: [...intent.lines].sort((a, b) => a.id.localeCompare(b.id)) });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A local cart-cache cleanup marker, never payment or order authority. */
export async function settleGuestCheckoutCart(
  storage: GuestCheckoutRetentionStorage | null,
  result: GuestCheckoutWireResult,
): Promise<boolean> {
  if (!storage || !result.ok || !checkoutCanConfirm(result)) return false;
  const retained = readGuestCheckoutRetention(storage);
  if (!retained || retained.capabilityId !== result.capabilityId ||
      retained.attemptId !== result.checkout.attemptId) return false;
  const order = result.checkout.order!;
  if (retained.cartSettlement?.orderId === order.orderId && !retained.cartSettlement.pending) return true;
  try {
    const loaded = loadGuestCartIntent(GUEST_CART_STORAGE_KEY, storage);
    if (!loaded.persisted) return false;
    const currentFingerprint = await fingerprint(loaded.intent);
    const marker = retained.cartSettlement?.orderId === order.orderId
      ? retained.cartSettlement
      : { orderId: order.orderId, fingerprint: currentFingerprint, pending: true };
    const marked: GuestCheckoutRetention = { ...retained, cartSettlement: marker };
    // Record intent identity before cleanup. A failed write or later changed
    // cart cannot make a repeated paid callback erase newly added intent.
    storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify(marked));
    if (marker.fingerprint === currentFingerprint) {
      const purchased = new Map(order.lines.map((line) => [line.id, line.quantity]));
      const next: GuestCartIntent = { version: 1, lines: loaded.intent.lines.filter(
        (line) => purchased.get(line.id) !== line.quantity,
      ) };
      if (!saveGuestCartIntent(GUEST_CART_STORAGE_KEY, next, storage).persisted) return false;
    }
    storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({
      ...marked, cartSettlement: { ...marker, pending: false },
    }));
    return readGuestCheckoutRetention(storage)?.cartSettlement?.pending === false;
  } catch {
    return false;
  }
}
