import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GUEST_CHECKOUT_BLOCKED_REASON,
  GUEST_CHECKOUT_REASON,
  PLAYGROUND_STORE_META,
  addGuestCartLine,
  emptyGuestCartIntent,
  admitPlaygroundStoreStorage,
  playgroundStoreStorage,
  presentGuestCart,
  retainGuestCheckoutCapability,
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

function pageNamingStore(tag: string | null, started = 0): void {
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      tag !== null && selector === `meta[name="${PLAYGROUND_STORE_META}"]`
        ? { getAttribute: (name: string) => (name === "content" ? tag : name === "data-started" ? String(started) : null) }
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

  it("puts the tag and session start in the page head under the name the cart reads", () => {
    expect(WORKER_STORE_META).toBe(PLAYGROUND_STORE_META);
    expect(injectPlaygroundStoreTag('<html><head lang="en"><title>x</title></head></html>', "abc", 1792712082000))
      .toBe('<html><head lang="en"><meta name="dinkus-playground-store" content="abc" data-started="1792712082000" /><title>x</title></head></html>');
  });
});

describe("a new playground store starts with an empty cart", () => {
  const leftovers = {
    "dinkus.guest-cart.v1": '{"lines":[]}',
    "dinkus.guest-checkout.v1": "{}",
    "dinkus.shopper-session.v1": "{}",
  };
  const saved = (tag: string, started: number) => JSON.stringify({ tag, started });
  const kept = (storage: Storage) => Object.keys(leftovers).every((key) => storage.getItem(key) !== null);

  it("clears the cart, checkout attempt and sign-in when a newer store's page loads", () => {
    const storage = memoryStorage({ ...leftovers, "dinkus.playground-store": saved("old", 1000) });
    pageNamingStore("new", 2000);
    expect(admitPlaygroundStoreStorage(storage)).toBe(true);
    for (const key of Object.keys(leftovers)) expect(storage.getItem(key)).toBeNull();
    expect(JSON.parse(storage.getItem("dinkus.playground-store") ?? "null")).toEqual({ tag: "new", started: 2000 });
  });

  it("keeps state it cannot prove stale the first time a tagged page loads", () => {
    const storage = memoryStorage({ ...leftovers });
    pageNamingStore("current", 2000);
    expect(admitPlaygroundStoreStorage(storage)).toBe(true);
    expect(kept(storage)).toBe(true);
    expect(JSON.parse(storage.getItem("dinkus.playground-store") ?? "null")).toEqual({ tag: "current", started: 2000 });
  });

  it("gives a tab left open on an older store no storage, so it cannot clear the newer store", () => {
    const storage = memoryStorage({ ...leftovers, "dinkus.playground-store": saved("newer", 2000) });
    pageNamingStore("older", 1000);
    expect(admitPlaygroundStoreStorage(storage)).toBe(false);
    expect(kept(storage)).toBe(true);
    expect(JSON.parse(storage.getItem("dinkus.playground-store") ?? "null")).toEqual({ tag: "newer", started: 2000 });
  });

  it("keeps everything within the same store and on pages with no tag", () => {
    const storage = memoryStorage({ ...leftovers, "dinkus.playground-store": saved("same", 1000) });
    pageNamingStore("same", 1000);
    expect(admitPlaygroundStoreStorage(storage)).toBe(true);
    pageNamingStore(null);
    expect(admitPlaygroundStoreStorage(storage)).toBe(true);
    expect(kept(storage)).toBe(true);
  });
});

describe("storage handed to work that outlives its store", () => {
  const checkout = (capabilityId: string) => ({
    ok: true as const,
    capabilityId,
    capability: { capabilityId, capability: `${capabilityId}.secret`, retention: "json-body" as const, header: "x" },
    checkout: { attemptId: null },
  });

  it("cannot write an older store's checkout into a newer store", () => {
    const storage = memoryStorage({ "dinkus.playground-store": JSON.stringify({ tag: "a", started: 1000 }) });
    pageNamingStore("a", 1000);
    const port = playgroundStoreStorage(storage);
    expect(port).not.toBeNull();
    // A newer store's page takes over while this page's checkout is on its way.
    storage.setItem("dinkus.playground-store", JSON.stringify({ tag: "b", started: 2000 }));
    storage.setItem("dinkus.guest-cart.v1", '{"lines":[]}');
    expect(port!.getItem("dinkus.guest-cart.v1")).toBeNull();
    expect(retainGuestCheckoutCapability(port, checkout("cap-a") as never)).toBeNull();
    expect(storage.getItem("dinkus.guest-checkout.v1")).toBeNull();
    expect(storage.getItem("dinkus.guest-cart.v1")).toBe('{"lines":[]}');
  });

  it("works as plain storage while its store is current, and on pages with no tag", () => {
    const storage = memoryStorage();
    pageNamingStore("a", 1000);
    expect(retainGuestCheckoutCapability(playgroundStoreStorage(storage), checkout("cap-a") as never)).not.toBeNull();
    pageNamingStore(null);
    expect(playgroundStoreStorage(storage)).toBe(storage);
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
