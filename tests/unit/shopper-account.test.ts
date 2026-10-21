import { beforeEach, describe, expect, it } from "vitest";
import { COMMERCE_RUNTIME_ID } from "../../src/features/commerce-profile/selected.js";
import {
  evaluatePublicBoundary,
  slashlessRedirectPath,
} from "../../src/features/security/public-boundary.js";
import {
  DEMO_SHOPPER_EMAIL,
  DEMO_SHOPPER_ORDER_ID,
  DEMO_SHOPPER_ORDER_NUMBER,
  PLAYGROUND_DEMO_SESSION_ENDPOINT,
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_PROFILE_ENDPOINT,
  SHOPPER_SESSION_STORAGE_KEY,
  SHOPPER_SIGN_IN_START_ENDPOINT,
  SHOPPER_SIGN_IN_VERIFY_ENDPOINT,
  SHOPPER_SIGN_OUT_ENDPOINT,
  clearStoredShopperSession,
  formatOrderMoney,
  isValidShopperSessionToken,
  readStoredShopperSession,
  saveStoredShopperSession,
  unwrapPluginEnvelope,
  type ShopperSessionStorage,
} from "../../src/features/shopper-account/index.js";
import {
  clearCapturedProofEmails,
  clearCapturedProofLeads,
  deliverPlaygroundShopperEmail,
  readCapturedProofEmail,
  readCapturedProofLeads,
  recordVerifiedPlaygroundLead,
  type D1DatabaseLike,
} from "../../src/features/shopper-account/playground-runtime.js";

function createMemoryStorage(): ShopperSessionStorage {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

describe("shopper-account browser session and public routes", () => {
  beforeEach(() => {
    clearCapturedProofEmails();
    clearCapturedProofLeads();
  });

  it("exposes exact Commerce public account routes and demo session route", () => {
    expect(SHOPPER_SIGN_IN_START_ENDPOINT).toBe(
      `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-in/start`,
    );
    expect(SHOPPER_SIGN_IN_VERIFY_ENDPOINT).toBe(
      `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-in/verify`,
    );
    expect(SHOPPER_SIGN_OUT_ENDPOINT).toBe(
      `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/sign-out`,
    );
    expect(SHOPPER_ORDERS_ENDPOINT).toBe(
      `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/orders`,
    );
    expect(SHOPPER_PROFILE_ENDPOINT).toBe(
      `/_emdash/api/plugins/${COMMERCE_RUNTIME_ID}/account/profile`,
    );
    expect(PLAYGROUND_DEMO_SESSION_ENDPOINT).toBe("/api/account/demo-session");
  });

  it("validates, stores, expires, and clears browser shopper sessions", () => {
    const storage = createMemoryStorage();
    const validToken = "csess_1234567890abcdef.1234567890abcdef1234567890abcdef";
    expect(isValidShopperSessionToken(validToken)).toBe(true);
    expect(isValidShopperSessionToken("invalid-token")).toBe(false);

    const saved = saveStoredShopperSession(
      {
        sessionId: "csess_1234567890abcdef",
        sessionToken: validToken,
        email: "Shopper@Example.com",
        expiresAt: 2_000,
      },
      storage,
    );
    expect(saved).toBe(true);

    const active = readStoredShopperSession(storage, 1_500);
    expect(active).toEqual({
      sessionId: "csess_1234567890abcdef",
      sessionToken: validToken,
      email: "shopper@example.com",
      expiresAt: 2_000,
    });

    const expired = readStoredShopperSession(storage, 2_000);
    expect(expired).toBeNull();
    expect(storage.getItem(SHOPPER_SESSION_STORAGE_KEY)).toBeNull();

    saveStoredShopperSession(
      {
        sessionId: "csess_1234567890abcdef",
        sessionToken: validToken,
        email: "shopper@example.com",
        expiresAt: 3_000,
      },
      storage,
    );
    clearStoredShopperSession(storage);
    expect(readStoredShopperSession(storage, 1_500)).toBeNull();
  });

  it("formats USD order money and unwraps EmDash plugin envelopes", () => {
    expect(formatOrderMoney({ currency: "USD", minor: "3800" })).toBe("$38.00");
    expect(formatOrderMoney({ currency: "EUR", minor: "3800" })).toBe("$0.00");

    expect(
      unwrapPluginEnvelope({
        success: true,
        data: { ok: true, orders: [] },
      }),
    ).toEqual({ ok: true, orders: [] });
    expect(
      unwrapPluginEnvelope({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Sign in required." },
      }),
    ).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Sign in required." },
    });
  });

  it("admits /account and Commerce public account routes through the public boundary", () => {
    expect(slashlessRedirectPath("/account/")).toBe("/account");
    expect(evaluatePublicBoundary("GET", "/account").allowed).toBe(true);
    expect(evaluatePublicBoundary("HEAD", "/account").allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", "/api/account/demo-session").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/api/account/demo-session").allowed).toBe(false);
    expect(evaluatePublicBoundary("POST", SHOPPER_SIGN_IN_START_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", SHOPPER_SIGN_IN_VERIFY_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", SHOPPER_SIGN_OUT_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", SHOPPER_ORDERS_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", SHOPPER_ORDERS_ENDPOINT).allowed).toBe(false);
    expect(evaluatePublicBoundary("GET", SHOPPER_PROFILE_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", SHOPPER_PROFILE_ENDPOINT).allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/api/proof/shopper-account").allowed).toBe(false);
  });

  it("captures OTP email in local proof mode and sends through Cloudflare EMAIL binding when configured", async () => {
    const sent: unknown[] = [];
    await deliverPlaygroundShopperEmail(
      {
        to: "Alex@Example.com",
        subject: "Your DinkusKit Store sign-in code is 482910",
        text: "Use verification code 482910 to sign in to DinkusKit Store.",
      },
      {
        DINKUS_PROOF_MODE: "1",
        EMAIL: {
          async send(msg: unknown) {
            sent.push(msg);
            return { messageId: "msg_1" };
          },
        },
      },
    );

    const captured = readCapturedProofEmail("alex@example.com");
    expect(captured?.code).toBe("482910");
    expect(sent).toHaveLength(1);
  });

  it("records verified opt-in leads to PLAYGROUND_LEADS_DB while excluding the demo shopper identity", async () => {
    const queries: Array<{ sql: string; bound: unknown[] }> = [];
    const mockD1: D1DatabaseLike = {
      prepare(sql: string) {
        const entry = { sql, bound: [] as unknown[] };
        queries.push(entry);
        return {
          bind(...values: unknown[]) {
            entry.bound = values;
            return this;
          },
          async run() {
            return {};
          },
          async all() {
            return { results: [] };
          },
        };
      },
    };

    const skippedDemo = await recordVerifiedPlaygroundLead(
      DEMO_SHOPPER_EMAIL,
      { PLAYGROUND_LEADS_DB: mockD1 },
      "2026-10-20T12:00:00.000Z",
    );
    expect(skippedDemo).toBe(false);
    expect(queries).toHaveLength(0);
    expect(readCapturedProofLeads()).toEqual([]);

    const recorded = await recordVerifiedPlaygroundLead(
      "Taylor@Example.com",
      { PLAYGROUND_LEADS_DB: mockD1 },
      "2026-10-20T12:05:00.000Z",
    );
    expect(recorded).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.bound).toEqual([
      "taylor@example.com",
      "2026-10-20T12:05:00.000Z",
      "2026-10-20T12:05:00.000Z",
      "playground-account-otp",
    ]);
    expect(readCapturedProofLeads()).toEqual([
      {
        email: "taylor@example.com",
        firstVerifiedAt: "2026-10-20T12:05:00.000Z",
        lastVerifiedAt: "2026-10-20T12:05:00.000Z",
        optInSource: "playground-account-otp",
        verificationCount: 1,
      },
    ]);
    expect(DEMO_SHOPPER_ORDER_ID).toBe("ord_demo_shopper_1001");
    expect(DEMO_SHOPPER_ORDER_NUMBER).toBe(1001);
  });
});
