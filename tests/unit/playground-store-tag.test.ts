import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GUEST_CHECKOUT_BLOCKED_REASON,
  GUEST_CHECKOUT_REASON,
  PLAYGROUND_STORE_META,
  addGuestCartLine,
  emptyGuestCartIntent,
  forgetEndedPlaygroundStore,
  presentGuestCart,
} from "../../src/features/guest-cart/index.js";
import {
  PLAYGROUND_STORE_META as WORKER_STORE_META,
  injectPlaygroundStoreTag,
  playgroundStoreTag,
  startedPlaygroundSession,
} from "../../src/features/playground/contract.js";

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, value); },
  };
}

function pageNamingStore(tag: string | null): void {
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      tag !== null && selector === `meta[name="${PLAYGROUND_STORE_META}"]`
        ? { getAttribute: (name: string) => (name === "content" ? tag : null) }
        : null,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("playground store tag", () => {
  it("names a store without its session token, the same way every time", async () => {
    const tag = await playgroundStoreTag("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(tag).toMatch(/^[0-9a-f]{32}$/);
    expect(tag).not.toContain("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(await playgroundStoreTag("01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe(tag);
    expect(await playgroundStoreTag("01JABCDEFGHJKMNPQRSTVWXYZ1")).not.toBe(tag);
  });

  it("reads the session a response starts from its Set-Cookie", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "other=1; Path=/");
    headers.append("Set-Cookie", "emdash_playground=01JNEWSESSION; Path=/; HttpOnly");
    expect(startedPlaygroundSession(headers)).toBe("01JNEWSESSION");
    expect(startedPlaygroundSession(new Headers())).toBeUndefined();
  });

  it("puts the tag in the page head under the name the cart reads", () => {
    expect(WORKER_STORE_META).toBe(PLAYGROUND_STORE_META);
    expect(injectPlaygroundStoreTag('<html><head lang="en"><title>x</title></head></html>', "abc"))
      .toBe('<html><head lang="en"><meta name="dinkus-playground-store" content="abc" /><title>x</title></head></html>');
  });
});

describe("a new playground store starts with an empty cart", () => {
  const leftovers = {
    "dinkus.guest-cart.v1": '{"lines":[]}',
    "dinkus.guest-checkout.v1": "{}",
    "dinkus.shopper-session.v1": "{}",
  };

  it("clears the cart, checkout attempt and sign-in from an ended store", () => {
    const storage = memoryStorage({ ...leftovers, "dinkus.playground-store": "old" });
    pageNamingStore("new");
    forgetEndedPlaygroundStore(storage);
    for (const key of Object.keys(leftovers)) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem("dinkus.playground-store")).toBe("new");
  });

  it("keeps everything within the same store and on pages with no tag", () => {
    const storage = memoryStorage({ ...leftovers, "dinkus.playground-store": "same" });
    pageNamingStore("same");
    forgetEndedPlaygroundStore(storage);
    pageNamingStore(null);
    forgetEndedPlaygroundStore(storage);
    for (const [key, value] of Object.entries(leftovers)) expect(storage.getItem(key)).toBe(value);
  });
});

describe("checkout reason", () => {
  const intent = addGuestCartLine(emptyGuestCartIntent(), "gone-1", 1).intent;

  it("names the products in the way when the store takes checkouts", () => {
    const view = presentGuestCart({ intent, snapshots: [{ id: "gone-1", found: false }], checkoutAdmitted: true });
    expect(view.checkoutEnabled).toBe(false);
    expect(view.checkoutReason).toBe(GUEST_CHECKOUT_BLOCKED_REASON);
  });

  it("still says checkout is off when the store does not take checkouts", () => {
    const view = presentGuestCart({ intent, snapshots: [{ id: "gone-1", found: false }], checkoutAdmitted: false });
    expect(view.checkoutReason).toBe(GUEST_CHECKOUT_REASON);
  });
});
