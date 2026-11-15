import { describe, expect, it } from "vitest";

import {
  GUEST_CHECKOUT_BLOCKED_REASON,
  GUEST_CHECKOUT_REASON,
  addGuestCartLine,
  emptyGuestCartIntent,
  presentGuestCart,
} from "../../src/features/guest-cart/index.js";
import {
  PLAYGROUND_STORE_META as WORKER_STORE_META,
  injectPlaygroundStoreTag,
  playgroundStoreTag,
  startedPlaygroundSession,
} from "../../src/features/playground/contract.js";

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

  it("puts the tag and session start in the page head", () => {
    expect(WORKER_STORE_META).toBe("dinkus-playground-store");
    expect(injectPlaygroundStoreTag('<html><head lang="en"><title>x</title></head></html>', "abc", 1792712082000))
      .toBe('<html><head lang="en"><meta name="dinkus-playground-store" content="abc" data-started="1792712082000" /><title>x</title></head></html>');
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
