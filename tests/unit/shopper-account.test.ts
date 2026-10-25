import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  SHOPPER_CATALOG_SNAPSHOT_BATCH_SIZE,
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_PROFILE_ENDPOINT,
  SHOPPER_SESSION_STORAGE_KEY,
  SHOPPER_SIGN_IN_START_ENDPOINT,
  SHOPPER_SIGN_IN_VERIFY_ENDPOINT,
  SHOPPER_SIGN_OUT_ENDPOINT,
  clearStoredShopperSession,
  collectOrderCatalogSnapshotBatches,
  formatOrderMoney,
  isValidShopperSessionToken,
  readStoredShopperSession,
  resolveOrderLinePresentation,
  saveStoredShopperSession,
  unwrapPluginEnvelope,
  type ShopperOrderCatalogSnapshot,
  type ShopperOrderItem,
  type ShopperSessionStorage,
} from "../../src/features/shopper-account/index.js";
import {
  PLAYGROUND_LEADS_DO_NAME,
  PLAYGROUND_ORIGIN,
  clearCapturedProofEmails,
  clearCapturedProofLeads,
  deliverPlaygroundShopperEmail,
  isPlaygroundLeadStorageConfigured,
  isPlaygroundPreviewHost,
  playgroundShopperAccountHostOptions,
  readCapturedProofEmail,
  readCapturedProofLeads,
  readVerifiedPlaygroundLeads,
  recordVerifiedPlaygroundLead,
  resolvePlaygroundAccountSiteOrigin,
  withShopperAccountRequest,
  type D1DatabaseLike,
  type LeadsDurableObjectNamespaceLike,
} from "../../src/features/shopper-account/playground-runtime.js";
import {
  fetchOrderCatalogSnapshots,
  renderOrderItemMarkup,
} from "../../src/features/shopper-account/shopper-account-client.js";

const root = resolve(import.meta.dirname, "../..");

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
    delete (globalThis as { __dinkusPlaygroundEnv?: unknown }).__dinkusPlaygroundEnv;
    delete (globalThis as { __dinkusPlaygroundRequestOrigin?: unknown })
      .__dinkusPlaygroundRequestOrigin;
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

  it("resolves the main Playground and local proof origins while keeping PR preview hosts closed", () => {
    expect(resolvePlaygroundAccountSiteOrigin({})).toBeUndefined();
    expect(
      resolvePlaygroundAccountSiteOrigin({
        DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: PLAYGROUND_ORIGIN,
      }),
    ).toBe(PLAYGROUND_ORIGIN);
    expect(
      isPlaygroundPreviewHost(
        new URL("https://pr-117.playground.dinkuskit.com/account"),
        PLAYGROUND_ORIGIN,
      ),
    ).toBe(true);
    expect(
      isPlaygroundPreviewHost(
        new URL("https://playground.dinkuskit.com/account"),
        PLAYGROUND_ORIGIN,
      ),
    ).toBe(false);

    // Dynamic per-request resolution via withShopperAccountRequest on host options created at build time.
    const hostOptions = playgroundShopperAccountHostOptions({});
    expect(hostOptions.siteUrl).toBeUndefined();
    const resolvedInPlayground = withShopperAccountRequest(
      PLAYGROUND_ORIGIN,
      { DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: PLAYGROUND_ORIGIN },
      () => hostOptions.siteUrl,
    );
    expect(resolvedInPlayground).toBe(PLAYGROUND_ORIGIN);
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

  it("requires durable PLAYGROUND_LEADS_DB outside local proof mode and persists leads across D1 and Durable Object SQLite", async () => {
    expect(isPlaygroundLeadStorageConfigured({})).toBe(false);
    expect(isPlaygroundLeadStorageConfigured({ DINKUS_LOCAL_PROOF: "1" })).toBe(true);
    await expect(
      recordVerifiedPlaygroundLead("taylor@example.com", {}, "2026-10-20T12:00:00.000Z"),
    ).rejects.toThrow(/PLAYGROUND_LEADS_DB/);

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
      { PLAYGROUND_LEADS_DB: mockD1, DINKUS_LOCAL_PROOF: "1" },
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

    // Durable Object SQLite binding (PLAYGROUND_LEADS_DB -> EmDashPreviewDB)
    const doQueries: Array<{ name: string; sql: string; params?: unknown[] }> = [];
    const doRows = new Map<
      string,
      {
        email: string;
        first_verified_at: string;
        last_verified_at: string;
        opt_in_source: string;
        verification_count: number;
      }
    >();
    const mockDoNamespace: LeadsDurableObjectNamespaceLike = {
      idFromName(name: string) {
        return name;
      },
      get(id: unknown) {
        return {
          async query(sql: string, params?: unknown[]) {
            doQueries.push({ name: String(id), sql, params });
            if (sql.includes("INSERT INTO playground_email_leads") && params) {
              const [email, firstAt, lastAt, source] = params as [string, string, string, string];
              const prev = doRows.get(email);
              doRows.set(email, {
                email,
                first_verified_at: prev ? prev.first_verified_at : firstAt,
                last_verified_at: lastAt,
                opt_in_source: source,
                verification_count: (prev?.verification_count ?? 0) + 1,
              });
            }
            if (sql.includes("SELECT")) {
              return {
                rows: [...doRows.values()].map((r) => ({
                  email: r.email,
                  firstVerifiedAt: r.first_verified_at,
                  lastVerifiedAt: r.last_verified_at,
                  optInSource: r.opt_in_source,
                  verificationCount: r.verification_count,
                })),
              };
            }
            return { rows: [], changes: 1 };
          },
        };
      },
    };

    expect(isPlaygroundLeadStorageConfigured({ PLAYGROUND_LEADS_DB: mockDoNamespace })).toBe(true);
    await recordVerifiedPlaygroundLead(
      "Jordan@Example.com",
      { PLAYGROUND_LEADS_DB: mockDoNamespace },
      "2026-10-20T13:00:00.000Z",
    );
    await recordVerifiedPlaygroundLead(
      "jordan@example.com",
      { PLAYGROUND_LEADS_DB: mockDoNamespace },
      "2026-10-20T14:30:00.000Z",
    );
    expect(doQueries[0]?.name).toBe(PLAYGROUND_LEADS_DO_NAME);
    const persisted = await readVerifiedPlaygroundLeads({ PLAYGROUND_LEADS_DB: mockDoNamespace });
    expect(persisted).toEqual([
      {
        email: "jordan@example.com",
        firstVerifiedAt: "2026-10-20T13:00:00.000Z",
        lastVerifiedAt: "2026-10-20T14:30:00.000Z",
        optInSource: "playground-account-otp",
        verificationCount: 2,
      },
    ]);
    expect(DEMO_SHOPPER_ORDER_ID).toBe("ord_demo_shopper_1001");
    expect(DEMO_SHOPPER_ORDER_NUMBER).toBe(1001);
  });

  it("retains captured proof emails and leads on globalThis across SSR module reloads", async () => {
    await deliverPlaygroundShopperEmail(
      {
        to: "reload.proof@example.com",
        subject: "Sign-in code",
        text: "Your sign-in code is 654321.",
      },
      { DINKUS_PROOF_MODE: "1" },
    );
    await recordVerifiedPlaygroundLead(
      "reload.proof@example.com",
      { DINKUS_PROOF_MODE: "1" },
      "2026-10-21T19:00:00.000Z",
    );

    const globalState = globalThis as {
      __dinkusCapturedProofEmails?: Map<string, { code: string | null }>;
      __dinkusCapturedProofLeads?: Map<string, { email: string }>;
    };
    expect(globalState.__dinkusCapturedProofEmails?.get("reload.proof@example.com")?.code).toBe(
      "654321",
    );
    expect(globalState.__dinkusCapturedProofLeads?.get("reload.proof@example.com")?.email).toBe(
      "reload.proof@example.com",
    );
    expect(readCapturedProofEmail("reload.proof@example.com")?.code).toBe("654321");
    expect(readCapturedProofLeads().map((lead) => lead.email)).toContain(
      "reload.proof@example.com",
    );
  });

  it("resolves product thumbnails, SKU badges, and variant metadata from catalog snapshots and order lines without guessing missing media", () => {
    const demoShirt = resolveOrderLinePresentation(
      {
        catalogItemId: "demo-hosted-shirt",
        name: "Dinkus Demo Heavyweight T-Shirt",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "3800" },
      },
      { playgroundMode: true },
    );
    expect(demoShirt).toEqual({
      catalogItemId: "demo-hosted-shirt",
      name: "Dinkus Demo Heavyweight T-Shirt",
      quantity: 1,
      unitPriceText: "$38.00",
      thumbnailUrl: "/images/products/shirt.svg",
      thumbnailAlt: "Dinkus Demo Heavyweight T-Shirt thumbnail",
      sku: "DEMO-HOSTED-SHIRT",
      variantLabel: "Heavyweight Cotton · Regular Fit",
      fulfillmentLabel: "Physical",
    });

    // Outside playgroundMode, seeded demo placeholders are not injected for bare order lines
    const demoShirtShippingMode = resolveOrderLinePresentation({
      catalogItemId: "demo-hosted-shirt",
      name: "Dinkus Demo Heavyweight T-Shirt",
      quantity: 1,
      unitPrice: { currency: "USD", minor: "3800" },
    });
    expect(demoShirtShippingMode.thumbnailUrl).toBeNull();
    expect(demoShirtShippingMode.sku).toBeNull();
    expect(demoShirtShippingMode.variantLabel).toBeNull();

    const variantChoiceOrder = {
      choices: [
        {
          productId: "demo-hosted-hoodie",
          catalogItemId: "demo-hosted-hoodie-m",
          selections: [
            {
              optionId: "size",
              optionLabel: "Size",
              valueId: "m",
              valueLabel: "Medium",
            },
          ],
          fulfillment: "physical" as const,
        },
      ],
    };
    const snapshot: ShopperOrderCatalogSnapshot = {
      id: "demo-hosted-hoodie-m",
      found: true,
      name: "Dinkus Demo Fleece Hoodie",
      sku: "DEMO-HOSTED-HOODIE-M",
      fulfillment: "physical",
      thumbnail: {
        src: "/images/products/hoodie.svg",
        alt: "Dinkus Demo Fleece Hoodie front view",
      },
    };
    const hoodieVariant = resolveOrderLinePresentation(
      {
        catalogItemId: "demo-hosted-hoodie-m",
        name: "Dinkus Demo Fleece Hoodie",
        quantity: 2,
        unitPrice: { currency: "USD", minor: "6400" },
      },
      { order: variantChoiceOrder, snapshot },
    );
    expect(hoodieVariant).toEqual({
      catalogItemId: "demo-hosted-hoodie-m",
      name: "Dinkus Demo Fleece Hoodie",
      quantity: 2,
      unitPriceText: "$64.00",
      thumbnailUrl: "/images/products/hoodie.svg",
      thumbnailAlt: "Dinkus Demo Fleece Hoodie front view",
      sku: "DEMO-HOSTED-HOODIE-M",
      variantLabel: "Size: Medium",
      fulfillmentLabel: "Physical",
    });

    // Non-demo merchant item without media or option selections renders null thumbnail and no guessed variant badge
    const merchantNoMedia = resolveOrderLinePresentation(
      {
        catalogItemId: "merchant-jacket-m",
        name: "Field Jacket",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "12000" },
      },
      {
        snapshot: {
          id: "merchant-jacket-m",
          found: true,
          name: "Field Jacket",
          sku: "MERCHANT-JACKET-M",
          fulfillment: "physical",
          thumbnail: null,
        },
      },
    );
    expect(merchantNoMedia).toEqual({
      catalogItemId: "merchant-jacket-m",
      name: "Field Jacket",
      quantity: 1,
      unitPriceText: "$120.00",
      thumbnailUrl: null,
      thumbnailAlt: "Field Jacket thumbnail",
      sku: "MERCHANT-JACKET-M",
      variantLabel: null,
      fulfillmentLabel: "Physical",
    });

    const unmappedNoMeta = resolveOrderLinePresentation({
      catalogItemId: "custom-unmapped-item",
      name: "Mystery Parcel",
      quantity: 1,
      unitPrice: { currency: "USD", minor: "1500" },
      thumbnailUrl: "javascript:alert(1)",
    });
    expect(unmappedNoMeta.thumbnailUrl).toBeNull();
    expect(unmappedNoMeta.sku).toBeNull();
    expect(unmappedNoMeta.variantLabel).toBeNull();
  });

  it("renders thumbnail, missing-media placeholder, and variant metadata on .account-order-card__lines", () => {
    const order: ShopperOrderItem = {
      orderId: "ord_demo_shopper_1001",
      receiptId: "rcpt_demo_shopper_1001",
      number: 1001,
      status: "processing",
      paidAt: "2026-10-20T12:00:00.000Z",
      total: { currency: "USD", minor: "3800" },
      lines: [
        {
          catalogItemId: "demo-hosted-shirt",
          name: "Dinkus Demo Heavyweight T-Shirt",
          quantity: 1,
          unitPrice: { currency: "USD", minor: "3800" },
        },
      ],
      delivery: {
        name: "Demo Shopper",
        line1: "742 Evergreen Terrace",
        city: "Springfield",
        region: "OR",
        postalCode: "97477",
        country: "US",
      },
      phone: "555-0199",
    };
    const snapshots = new Map<string, ShopperOrderCatalogSnapshot>([
      [
        "demo-hosted-shirt",
        {
          id: "demo-hosted-shirt",
          found: true,
          name: "Dinkus Demo Heavyweight T-Shirt",
          sku: "DEMO-HOSTED-SHIRT",
          fulfillment: "physical",
        },
      ],
    ]);

    const markup = renderOrderItemMarkup(order, snapshots, { playgroundMode: true });
    expect(markup).toContain('class="account-order-card__lines"');
    expect(markup).toContain('data-account-order-line="demo-hosted-shirt"');
    expect(markup).toContain('data-account-order-line-image');
    expect(markup).toContain('src="/images/products/shirt.svg"');
    expect(markup).toContain('data-account-order-line-sku>SKU: DEMO-HOSTED-SHIRT</span>');
    expect(markup).toContain(
      'data-account-order-line-variant>Heavyweight Cotton · Regular Fit</span>',
    );
    expect(markup).toContain('data-account-order-line-fulfillment>Physical</span>');

    // Without media or playground fallback, renders "No image" placeholder and no guessed variant badge
    const noMediaMarkup = renderOrderItemMarkup(order, snapshots, { playgroundMode: false });
    expect(noMediaMarkup).toContain('account-order-line__thumb--placeholder');
    expect(noMediaMarkup).toContain('No image');
    expect(noMediaMarkup).not.toContain('data-account-order-line-image');
    expect(noMediaMarkup).not.toContain('data-account-order-line-variant');
  });

  it("batches all distinct historical product IDs up to GUEST_CART_MAX_LINES (40) per request without truncating at 20", async () => {
    expect(SHOPPER_CATALOG_SNAPSHOT_BATCH_SIZE).toBe(40);
    const totalDistinct = 55;
    const orders: ShopperOrderItem[] = [
      {
        orderId: "ord_batch_1",
        receiptId: "rcpt_batch_1",
        number: 3001,
        status: "processing",
        paidAt: "2026-10-21T12:00:00.000Z",
        total: { currency: "USD", minor: "55000" },
        lines: Array.from({ length: totalDistinct }, (_, idx) => ({
          catalogItemId: `merchant-item-${idx + 1}`,
          name: `Merchant Item ${idx + 1}`,
          quantity: 1,
          unitPrice: { currency: "USD", minor: "1000" },
        })),
        delivery: null,
        phone: null,
      },
    ];

    const batches = collectOrderCatalogSnapshotBatches(orders);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(40);
    expect(batches[1]).toHaveLength(15);

    const requestedUrls: string[] = [];
    const snapshots = await fetchOrderCatalogSnapshots(orders, (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const queryIds = decodeURIComponent(url.split("?ids=")[1] ?? "").split(",");
      return new Response(
        JSON.stringify({
          products: queryIds.map((id) => ({
            id,
            found: true,
            name: `Snapshot ${id}`,
            sku: id.toUpperCase(),
            fulfillment: "physical",
            thumbnail: { src: "/merch/tee.svg", alt: `${id} photo` },
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch);

    expect(requestedUrls).toHaveLength(2);
    expect(snapshots.size).toBe(totalDistinct);
    expect(snapshots.get("merchant-item-21")?.sku).toBe("MERCHANT-ITEM-21");
    expect(snapshots.get("merchant-item-55")?.thumbnail?.src).toBe("/merch/tee.svg");
  });

  it("preserves all FEATURE_MAP.md selectors and vault/stamp card separation on ShopperAccount.astro", () => {
    const componentSource = readFileSync(
      resolve(root, "src/features/shopper-account/ShopperAccount.astro"),
      "utf8",
    );
    for (const selector of [
      "data-shopper-account",
      "data-account-signed-out",
      "data-account-start-form",
      "data-account-email",
      "data-account-opt-in",
      "data-account-start",
      "data-account-verify-form",
      "data-account-code",
      "data-account-verify",
      "data-account-demo-card",
      "data-account-demo-signin",
      "data-account-signed-in",
      "data-account-welcome",
      "data-account-current-email",
      "data-account-signout",
      "data-account-orders",
      "data-account-orders-empty",
      "data-account-orders-list",
      "data-account-profile-form",
      "data-account-profile-save",
      "data-account-profile-clear",
    ]) {
      expect(componentSource).toContain(selector);
    }
    expect(componentSource).toContain("account-card--vault");
    expect(componentSource).toContain("account-card--stamp");
    expect(componentSource).toContain("0 7px 0 0");
    expect(componentSource).toContain("#fcfbf8");
  });
});
