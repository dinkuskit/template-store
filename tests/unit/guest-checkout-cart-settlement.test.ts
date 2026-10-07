import { describe, expect, it } from "vitest";
import {
  GUEST_CART_STORAGE_KEY, GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY,
  createGuestCheckoutController, parseGuestCheckoutWireResult,
  readGuestCheckoutRetention, settleGuestCheckoutCart,
  type GuestCheckoutRetentionStorage,
} from "../../src/features/guest-cart/index.js";

function fixture() {
  const values = new Map<string, string>();
  const storage: GuestCheckoutRetentionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  storage.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({
    capabilityId: "cap-1", capability: "cap-1.secret", attemptId: "attempt-1",
  }));
  storage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ version: 1, lines: [
    { id: "purchased", quantity: 2 }, { id: "new-item", quantity: 1 },
  ] }));
  const wire = { ok: true, capabilityId: "cap-1", checkout: {
    schema: "dinkuskit.commerce.guest-checkout-projection/v1", state: "paid",
    attemptId: "attempt-1", redirectUrl: null, retryAfter: null,
    order: { orderId: "order:1", receiptId: "receipt:1", lines: [
      { catalogItemId: "purchased", quantity: 2 },
    ] },
  } };
  return { storage, wire, values, paid: parseGuestCheckoutWireResult(wire)! };
}

describe("confirmed checkout cart cleanup", () => {
  it("clears only matching purchased quantities and retains recovery without erasing a later cart on replay", async () => {
    const f = fixture();
    expect(await settleGuestCheckoutCart(f.storage, f.paid)).toBe(true);
    expect(JSON.parse(f.values.get(GUEST_CART_STORAGE_KEY)!).lines).toEqual([{ id: "new-item", quantity: 1 }]);
    expect(readGuestCheckoutRetention(f.storage)).toMatchObject({ capabilityId: "cap-1", attemptId: "attempt-1", cartSettlement: { orderId: "order:1", pending: false } });
    f.storage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ version: 1, lines: [{ id: "purchased", quantity: 2 }] }));
    expect(await settleGuestCheckoutCart(f.storage, f.paid)).toBe(true);
    expect(JSON.parse(f.values.get(GUEST_CART_STORAGE_KEY)!).lines).toEqual([{ id: "purchased", quantity: 2 }]);
  });

  it("does not clear changed quantities, unconfirmed orders or another retained attempt", async () => {
    const f = fixture();
    f.storage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ version: 1, lines: [{ id: "purchased", quantity: 3 }] }));
    expect(await settleGuestCheckoutCart(f.storage, f.paid)).toBe(true);
    expect(JSON.parse(f.values.get(GUEST_CART_STORAGE_KEY)!).lines[0].quantity).toBe(3);
    const pending = parseGuestCheckoutWireResult({ ...f.wire, checkout: { ...f.wire.checkout, state: "pending", order: null } })!;
    expect(await settleGuestCheckoutCart(f.storage, pending)).toBe(false);
    const other = parseGuestCheckoutWireResult({ ...f.wire, checkout: { ...f.wire.checkout, attemptId: "attempt-2" } })!;
    expect(await settleGuestCheckoutCart(f.storage, other)).toBe(false);
  });

  it("requires fresh authoritative paid status and completed cleanup before preparing a new purchase", async () => {
    const f = fixture();
    await settleGuestCheckoutCart(f.storage, f.paid);
    let calls = 0;
    const controller = createGuestCheckoutController({ admitted: true, storage: f.storage, transport: {
      fetch: async endpoint => {
        calls += 1;
        return Response.json(endpoint.endsWith("/status") ? f.wire : {
          ok: true, capabilityId: "cap-2", capability: { capabilityId: "cap-2", capability: "cap-2.secret", retention: "json-body", header: "x-commerce-guest-capability" },
          checkout: { ...f.wire.checkout, state: "pending", attemptId: null, order: null },
        });
      },
    } });
    expect((await controller.prepare()).failure).toBe("attempt-active");
    expect(calls).toBe(0);
    await controller.status();
    expect(controller.canPrepareNew()).toBe(true);
    expect((await controller.prepare()).failure).toBeNull();
    expect(readGuestCheckoutRetention(f.storage)).toEqual({ capabilityId: "cap-2", capability: "cap-2.secret", attemptId: null });
  });

  it("keeps cleanup pending on a failed cart write and preserves subsequent changed intent on recovery", async () => {
    const f = fixture();
    let failCartWrite = true;
    const writes: GuestCheckoutRetentionStorage = { getItem: f.storage.getItem, setItem: (key, value) => {
      if (key === GUEST_CART_STORAGE_KEY && failCartWrite) throw new Error("quota");
      f.storage.setItem(key, value);
    } };
    expect(await settleGuestCheckoutCart(writes, f.paid)).toBe(false);
    expect(readGuestCheckoutRetention(writes)?.cartSettlement?.pending).toBe(true);
    failCartWrite = false;
    f.storage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ version: 1, lines: [{ id: "purchased", quantity: 3 }] }));
    expect(await settleGuestCheckoutCart(writes, f.paid)).toBe(true);
    expect(JSON.parse(f.values.get(GUEST_CART_STORAGE_KEY)!).lines[0].quantity).toBe(3);
  });
});
