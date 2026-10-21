/**
 * Fresh and existing visitor databases: a real EmDash-migrated SQLite database
 * seeded the way the playground middleware seeds it. The merchant settings
 * bootstrap runs only for a fresh store, saved settings survive repeat seeding
 * (an isolate restart), and checkout bindings persisted in an existing database
 * stay readable and authoritative after re-seeding.
 */
import { createSettingsAccess, OptionsRepository, PluginStorageRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COMMERCE_PLUGIN_ID,
  ORDERS_COLLECTION,
  loadMerchantStoreSettings,
  saveMerchantStoreSettings,
  type OrderRecord,
} from "@dinkuskit/commerce";
import {
  CUSTOMER_SESSION_HEADER,
  NATIVE_SHOPPER_ACCOUNT_STORAGE,
  bindShopperAccountRuntime,
  readShopperAccountOrders,
  readShopperAccountProfile,
  signOutShopperSession,
  updateShopperAccountProfile,
} from "@dinkuskit/commerce/features/customers";
import { listOrdersForEmail, type OrdersCollection } from "@dinkuskit/commerce/features/orders";
import { applySeed } from "emdash/seed";
import { readFileSync } from "node:fs";
import { ensurePlaygroundDemoCatalog } from "../../src/features/playground/demo-commerce-seed.js";
import { playgroundCheckoutBindingStore } from "../../src/features/playground-checkout/binding-store.js";
import { playgroundAttemptBelongsToVisitor } from "../../src/features/playground-checkout/binding-auth.js";
import {
  DEMO_SHOPPER_EMAIL,
  DEMO_SHOPPER_ORDER_ID,
} from "../../src/features/shopper-account/index.js";
import {
  PRE_UPGRADE_SHOPPER_ORDER_ID,
  ensureDemoShopperOrder,
  ensurePreUpgradeShopperOrder,
  mintDemoShopperSession,
} from "../../src/features/shopper-account/playground-runtime.js";

let db: Kysely<never>;
beforeEach(async () => {
  db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
  await runMigrations(db as never);
  // The playground's own seed (schema only), as every visitor database gets it.
  const seed = JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf8"));
  await applySeed(db as never, seed, { includeContent: false, onConflict: "skip", skipMediaDownload: true });
});
afterEach(async () => { await db.destroy(); });

const settingsOf = () => loadMerchantStoreSettings(createSettingsAccess(new OptionsRepository(db as never), COMMERCE_PLUGIN_ID));

describe("playground visitor database state", () => {
  it("bootstraps US merchant settings once for a fresh store", async () => {
    expect((await settingsOf()).revision).toBeNull();
    await ensurePlaygroundDemoCatalog(db as never);
    const fresh = await settingsOf();
    expect(fresh.revision).not.toBeNull();
    expect(fresh.settings).toMatchObject({ storeCountry: "US", sellingCountries: ["US"], shippingCountries: ["US"] });
  });

  it("preserves saved settings, including an empty country list, across repeat seeding", async () => {
    await ensurePlaygroundDemoCatalog(db as never);
    const settings = createSettingsAccess(new OptionsRepository(db as never), COMMERCE_PLUGIN_ID);
    const before = await loadMerchantStoreSettings(settings);
    await saveMerchantStoreSettings(settings, { expectedRevision: before.revision, storeCountry: "US",
      sellingCountries: ["US"], shippingCountries: [], requirePhoneNumber: true });
    const saved = await settingsOf();
    await ensurePlaygroundDemoCatalog(db as never);
    await ensurePlaygroundDemoCatalog(db as never);
    const after = await settingsOf();
    expect(after.revision).toBe(saved.revision);
    expect(after.settings).toMatchObject({ shippingCountries: [], requirePhoneNumber: true });
  });

  it("keeps persisted checkout bindings authoritative in an existing database after re-seeding", async () => {
    await ensurePlaygroundDemoCatalog(db as never);
    const expiresAt = Date.now() + 30 * 60_000;
    await playgroundCheckoutBindingStore(db as never).put("attempt-existing", {
      recordKind: "playground-checkout-binding", attemptId: "attempt-existing", sessionId: "visitor-a", expiresAt });
    await ensurePlaygroundDemoCatalog(db as never);
    // A new store instance over the same database, as after an isolate restart.
    const reopened = playgroundCheckoutBindingStore(db as never);
    expect(await playgroundAttemptBelongsToVisitor("attempt-existing", "visitor-a", reopened)).toBe(true);
    expect(await playgroundAttemptBelongsToVisitor("attempt-existing", "visitor-b", reopened)).toBe(false);
    expect(await playgroundAttemptBelongsToVisitor("attempt-missing", "visitor-a", reopened)).toBe(false);
  });

  it("preserves existing shopper orders, saved profile addresses, and sessions across repeat seeding and rejects foreign/revoked/expired sessions", async () => {
    const trustedOrigin = "https://playground.dinkuskit.com";
    const baseMs = Date.parse("2026-10-20T18:00:00.000Z");
    let currentMs = baseMs;

    const runtimeForDb = (targetDb: Kysely<never>) => {
      const storage = {
        [NATIVE_SHOPPER_ACCOUNT_STORAGE.customers]: new PluginStorageRepository(
          targetDb as never,
          COMMERCE_PLUGIN_ID,
          NATIVE_SHOPPER_ACCOUNT_STORAGE.customers,
          [],
        ),
        [NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes]: new PluginStorageRepository(
          targetDb as never,
          COMMERCE_PLUGIN_ID,
          NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes,
          [],
        ),
        [NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions]: new PluginStorageRepository(
          targetDb as never,
          COMMERCE_PLUGIN_ID,
          NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions,
          [],
        ),
        [ORDERS_COLLECTION]: new PluginStorageRepository<OrderRecord>(
          targetDb as never,
          COMMERCE_PLUGIN_ID,
          ORDERS_COLLECTION,
          [],
        ),
      };
      return bindShopperAccountRuntime(storage, NATIVE_SHOPPER_ACCOUNT_STORAGE, {
        runtimeSiteUrl: trustedOrigin,
        constructorSiteUrl: trustedOrigin,
        topLevelSiteUrl: trustedOrigin,
        host: {
          siteUrl: trustedOrigin,
          storeName: "DinkusKit Playground",
          now: () => currentMs,
          loadOrdersForEmail: (emailKey: string) =>
            listOrdersForEmail(storage[ORDERS_COLLECTION] as unknown as OrdersCollection, emailKey),
          loadShippingCountries: async () => ({
            requirePhoneNumber: false,
            shippingCountries: ["US"],
          }),
        },
      });
    };

    await ensurePlaygroundDemoCatalog(db as never);
    // Populate a pre-upgrade paid order in the existing visitor DB before any shopper account seed/sign-in runs.
    await ensurePreUpgradeShopperOrder(db as never);
    const issued = await mintDemoShopperSession(db as never, trustedOrigin, {
      DINKUS_LOCAL_PROOF: "1",
      DINKUS_LOCAL_PROOF_NOW: String(currentMs),
    });

    const initialRuntimeA = runtimeForDb(db);
    const savedProfile = await updateShopperAccountProfile(
      initialRuntimeA,
      {
        delivery: {
          name: "Existing Visitor Shopper",
          line1: "900 Durable Ave",
          line2: "Apt 4B",
          city: "Portland",
          region: "OR",
          postalCode: "97205",
          country: "US",
        },
        phone: "503-555-0144",
      },
      { [CUSTOMER_SESSION_HEADER]: issued.capability.session },
    );
    expect(savedProfile.ok).toBe(true);

    // Re-seed both the playground catalog and demo shopper order, and open a fresh runtime (isolate restart).
    await ensurePlaygroundDemoCatalog(db as never);
    await ensureDemoShopperOrder(db as never);
    currentMs = baseMs + 5 * 60_000;
    const reopenedRuntimeA = runtimeForDb(db);

    const ordersRes = await readShopperAccountOrders(reopenedRuntimeA, {
      [CUSTOMER_SESSION_HEADER]: issued.capability.session,
    });
    expect(ordersRes.ok).toBe(true);
    if (ordersRes.ok) {
      expect(ordersRes.orders).toEqual([
        expect.objectContaining({ orderId: DEMO_SHOPPER_ORDER_ID, number: 1001 }),
        expect.objectContaining({ orderId: PRE_UPGRADE_SHOPPER_ORDER_ID, number: 1002 }),
      ]);
    }

    const profileRes = await readShopperAccountProfile(reopenedRuntimeA, {
      [CUSTOMER_SESSION_HEADER]: issued.capability.session,
    });
    expect(profileRes.ok).toBe(true);
    if (profileRes.ok) {
      expect(profileRes.profile).toMatchObject({
        email: DEMO_SHOPPER_EMAIL,
        delivery: expect.objectContaining({ line1: "900 Durable Ave", line2: "Apt 4B" }),
        phone: "503-555-0144",
      });
    }

    // Separate visitor database (Visitor B) must reject Visitor A's capability token before any read or write.
    const dbB = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    try {
      await runMigrations(dbB as never);
      const runtimeB = runtimeForDb(dbB);
      const foreignOrders = await readShopperAccountOrders(runtimeB, {
        [CUSTOMER_SESSION_HEADER]: issued.capability.session,
      });
      expect(foreignOrders).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "SESSION_DENIED" }),
      });

      const foreignProfileWrite = await updateShopperAccountProfile(
        runtimeB,
        {
          delivery: {
            name: "Attacker",
            line1: "1 Spoof St",
            city: "Portland",
            region: "OR",
            postalCode: "97201",
            country: "US",
          },
        },
        { [CUSTOMER_SESSION_HEADER]: issued.capability.session },
      );
      expect(foreignProfileWrite).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "SESSION_DENIED" }),
      });
    } finally {
      await dbB.destroy();
    }

    // Expiry refusal before any account read.
    currentMs = Date.parse(issued.capability.expiresAt) + 1_000;
    const expiredOrders = await readShopperAccountOrders(reopenedRuntimeA, {
      [CUSTOMER_SESSION_HEADER]: issued.capability.session,
    });
    expect(expiredOrders).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "SESSION_DENIED" }),
    });

    // Mint a second demo session and verify it replaces the fixed demo session slot and sign-out revokes it immediately.
    currentMs = baseMs + 10 * 60_000;
    const secondSession = await mintDemoShopperSession(db as never, trustedOrigin, {
      DINKUS_LOCAL_PROOF: "1",
      DINKUS_LOCAL_PROOF_NOW: String(currentMs),
    });
    expect(secondSession.capability.sessionId).toBe("csess_demo_shopper");
    expect(secondSession.capability.session).not.toBe(issued.capability.session);
    const priorTokenAfterRotation = await readShopperAccountProfile(reopenedRuntimeA, {
      [CUSTOMER_SESSION_HEADER]: issued.capability.session,
    });
    expect(priorTokenAfterRotation).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "SESSION_DENIED" }),
    });
    const signOutRes = await signOutShopperSession(
      reopenedRuntimeA,
      {},
      { [CUSTOMER_SESSION_HEADER]: secondSession.capability.session },
    );
    expect(signOutRes).toEqual({ ok: true, signedOut: true });

    const afterSignOut = await readShopperAccountProfile(reopenedRuntimeA, {
      [CUSTOMER_SESSION_HEADER]: secondSession.capability.session,
    });
    expect(afterSignOut).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "SESSION_DENIED" }),
    });
  });
});
