/**
 * Fresh and existing visitor databases: a real EmDash-migrated SQLite database
 * seeded the way the playground middleware seeds it. The merchant settings
 * bootstrap runs only for a fresh store, saved settings survive repeat seeding
 * (an isolate restart), and checkout bindings persisted in an existing database
 * stay readable and authoritative after re-seeding.
 */
import { createSettingsAccess, OptionsRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMERCE_PLUGIN_ID } from "@dinkuskit/commerce";
import { loadMerchantStoreSettings, saveMerchantStoreSettings } from "@dinkuskit/commerce";
import { applySeed } from "emdash/seed";
import { readFileSync } from "node:fs";
import { ensurePlaygroundDemoCatalog } from "../../src/features/playground/demo-commerce-seed.js";
import { playgroundCheckoutBindingStore } from "../../src/features/playground-checkout/binding-store.js";
import { playgroundAttemptBelongsToVisitor } from "../../src/features/playground-checkout/binding-auth.js";

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
});
