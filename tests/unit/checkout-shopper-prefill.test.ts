import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefillShopperContact } from "../../src/features/guest-cart/shopper-prefill.js";
import { SHOPPER_ORDERS_ENDPOINT, SHOPPER_SESSION_HEADER, SHOPPER_SESSION_STORAGE_KEY } from "../../src/features/shopper-account/index.js";

class Input { value = ""; }
class Select extends Input {}
const session = (name = "previous") => ({
  sessionId: `csess_synthetic_${name}`,
  sessionToken: `csess_synthetic_${name}.0123456789abcdef0123456789abcdef`,
  email: `${name}@example.test`,
  expiresAt: 4_102_444_800,
});
const profile = { email: "previous@example.test", delivery: {
  name: "Previous Synthetic Shopper", line1: "11 Previous Test Road", line2: "Unit 2",
  city: "Testville", region: "NC", postalCode: "27601", country: "US",
} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function form() {
  const fields = new Map<string, Input>();
  for (const name of ["email", "delivery-name", "delivery-line1", "delivery-line2", "delivery-city", "delivery-region", "delivery-postal-code", "delivery-country"]) {
    fields.set(`[data-guest-cart-${name}]`, name === "delivery-country" ? new Select() : new Input());
  }
  return {
    root: { querySelector: (selector: string) => fields.get(selector) ?? null } as unknown as Element,
    field: (name: string) => fields.get(`[data-guest-cart-${name}]`)!,
  };
}

describe("checkout shopper defaults", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map([[SHOPPER_SESSION_STORAGE_KEY, JSON.stringify(session())]]);
    vi.stubGlobal("HTMLInputElement", Input);
    vi.stubGlobal("HTMLSelectElement", Select);
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
    } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fills current-session empty fields, preserving independently edited checkout values", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn(() => response.promise); vi.stubGlobal("fetch", fetch);
    const { root, field } = form();
    const task = prefillShopperContact(root);
    expect(field("email").value).toBe(session().email);
    field("email").value = "checkout-draft@example.test";
    field("delivery-name").value = "Typed recipient";
    response.resolve(Response.json({ success: true, data: { ok: true, profile } }));
    await task;
    expect(field("email").value).toBe("checkout-draft@example.test");
    expect(field("delivery-name").value).toBe("Typed recipient");
    expect(field("delivery-line1").value).toBe(profile.delivery.line1);
    expect(field("delivery-country").value).toBe("US");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(SHOPPER_ORDERS_ENDPOINT, expect.objectContaining({
      method: "GET", headers: { accept: "application/json", [SHOPPER_SESSION_HEADER]: session().sessionToken },
    }));
  });

  for (const change of ["new-shopper", "same-email-new-capability", "sign-out", "clear-storage", "expiry", "unreadable-storage"] as const) {
    it(`ignores a late profile after ${change} without clearing checkout drafts or newer sign-ins`, async () => {
      const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
      const { root, field } = form(); const task = prefillShopperContact(root);
      field("email").value = "current-draft@example.test";
      field("delivery-name").value = "Current typed recipient";
      if (change === "new-shopper") values.set(SHOPPER_SESSION_STORAGE_KEY, JSON.stringify(session("current")));
      if (change === "same-email-new-capability") values.set(SHOPPER_SESSION_STORAGE_KEY, JSON.stringify({ ...session("current"), email: session().email }));
      if (change === "sign-out") values.delete(SHOPPER_SESSION_STORAGE_KEY);
      if (change === "clear-storage") values.clear();
      if (change === "expiry") values.set(SHOPPER_SESSION_STORAGE_KEY, JSON.stringify({ ...session(), expiresAt: 1 }));
      if (change === "unreadable-storage") vi.stubGlobal("window", { get localStorage() { throw new Error("unavailable"); } });
      const retained = values.get(SHOPPER_SESSION_STORAGE_KEY);
      response.resolve(Response.json({ success: true, data: { ok: true, profile } })); await task;
      expect(field("email").value).toBe("current-draft@example.test");
      expect(field("delivery-name").value).toBe("Current typed recipient");
      expect(field("delivery-line1").value).toBe("");
      expect(field("delivery-city").value).toBe("");
      expect(values.get(SHOPPER_SESSION_STORAGE_KEY)).toBe(change === "expiry" ? undefined : retained);
    });
  }

  it("checks identity after JSON decoding, not only after headers arrive", async () => {
    const body = deferred<unknown>();
    const json = vi.fn(() => body.promise);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json })));
    const { root, field } = form(); const task = prefillShopperContact(root);
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    values.set(SHOPPER_SESSION_STORAGE_KEY, JSON.stringify(session("current")));
    body.resolve({ success: true, data: { ok: true, profile } }); await task;
    expect(field("delivery-line1").value).toBe("");
  });

  it("does not fetch for a guest with no stored session", async () => {
    values.clear(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { root, field } = form(); await prefillShopperContact(root);
    expect(fetch).not.toHaveBeenCalled(); expect(field("email").value).toBe("");
  });

  for (const refusal of ["denied", "malformed", "network"] as const) {
    it(`keeps editable checkout and session on optional ${refusal} failure`, async () => {
      const fetch = vi.fn(async () => {
        if (refusal === "network") throw new Error("synthetic failure");
        return refusal === "denied" ? new Response("", { status: 401 }) : Response.json({ ok: true, profile: null });
      }); vi.stubGlobal("fetch", fetch);
      const retained = values.get(SHOPPER_SESSION_STORAGE_KEY);
      const { root, field } = form(); field("delivery-line1").value = "Typed street";
      await prefillShopperContact(root);
      expect(field("delivery-line1").value).toBe("Typed street");
      expect(values.get(SHOPPER_SESSION_STORAGE_KEY)).toBe(retained);
    });
  }
});
