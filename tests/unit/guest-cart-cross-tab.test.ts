import { afterEach, expect, it, vi } from "vitest";

import { GUEST_CART_STORAGE_KEY, GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY } from "../../src/features/guest-cart/index.js";

async function fixture() {
  vi.resetModules();
  const values = new Map<string, string>();
  const store = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  const setQuantity = (quantity: number) => values.set(GUEST_CART_STORAGE_KEY, JSON.stringify({
    version: 1, lines: [{ id: "notebook", quantity }],
  }));
  setQuantity(1);
  class Element {
    hidden = false;
    textContent = "";
    setAttribute() {}
    querySelector(): Element | null { return null; }
  }
  const badge = new Element();
  const nav = new Element();
  nav.querySelector = () => badge;
  const win = Object.assign(new EventTarget(), { localStorage: store });
  const listen = vi.spyOn(win, "addEventListener");
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-guest-cart-nav]" ? [nav] : [],
  });
  const { hydrateGuestCartControls } = await import("../../src/features/guest-cart/guest-cart-client.js");
  hydrateGuestCartControls();
  const change = (key: string | null = GUEST_CART_STORAGE_KEY, storageArea: unknown = store) => {
    // Node has no StorageEvent; the real two-tab browser spec covers native delivery.
    const event = Object.assign(new Event("storage"), { key, storageArea, newValue: "not trusted" });
    win.dispatchEvent(event);
  };
  return { values, store, setQuantity, win, listen, badge, change, hydrateGuestCartControls };
}

afterEach(() => vi.unstubAllGlobals());

it("refreshes from validated current local storage only, including removal and clear", async () => {
  const f = await fixture();
  expect(f.badge.textContent).toBe("1");
  f.setQuantity(3);
  f.change("unrelated-key");
  f.change(GUEST_CART_STORAGE_KEY, {}); // A sessionStorage event is not a cart change.
  expect(f.badge.textContent).toBe("1");
  f.change();
  expect(f.badge.textContent).toBe("3");
  f.values.set(GUEST_CART_STORAGE_KEY, "unsafe-json");
  f.change();
  expect(f.badge.textContent).toBe("0");
  expect(f.values.get(GUEST_CART_STORAGE_KEY)).toBe("unsafe-json");
  f.setQuantity(2);
  f.change();
  expect(f.badge.textContent).toBe("2");
  f.values.delete(GUEST_CART_STORAGE_KEY);
  f.change(null);
  expect(f.badge.textContent).toBe("0");
  expect(f.store.setItem).not.toHaveBeenCalled();
});

it("keeps locked checkout intent and does not replace it when storage cannot be read", async () => {
  const f = await fixture();
  const retained = JSON.stringify({ capabilityId: "cap-1", capability: "cap-1.secret", attemptId: "attempt-1" });
  f.values.set(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, retained);
  f.setQuantity(7);
  f.change();
  f.win.dispatchEvent(new Event("focus"));
  expect(f.badge.textContent).toBe("1");
  expect(f.values.get(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY)).toBe(retained);
  f.values.delete(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY);
  f.store.getItem.mockImplementation(() => { throw new Error("storage unavailable"); });
  f.change();
  expect(f.badge.textContent).toBe("1");
  f.store.getItem.mockImplementation((key) => f.values.get(key) ?? null);
  f.win.dispatchEvent(new Event("focus"));
  expect(f.badge.textContent).toBe("7");
  expect(f.store.setItem).not.toHaveBeenCalled();
});

it("refreshes on page return and registers the browser listeners just once", async () => {
  const f = await fixture();
  f.hydrateGuestCartControls();
  f.hydrateGuestCartControls();
  expect(f.listen.mock.calls.map(([name]) => name)).toEqual(["storage", "focus", "pageshow"]);
  f.setQuantity(4);
  f.win.dispatchEvent(new Event("pageshow"));
  expect(f.badge.textContent).toBe("4");
  f.setQuantity(5);
  f.win.dispatchEvent(new Event("focus"));
  expect(f.badge.textContent).toBe("5");
  expect(f.store.setItem).not.toHaveBeenCalled();
});
