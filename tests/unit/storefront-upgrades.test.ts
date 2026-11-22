import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kysely, sql } from "kysely";
import { OptionsRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed } from "emdash/seed";
import { PAGE_URL_PATTERN, STORE_FOLDER_GROUP, VISUAL_LABEL_FIELD_LABEL } from "../../src/features/store-shell/product-schema-upgrade.js";
import {
  STOREFRONT_UPGRADES,
  STOREFRONT_UPGRADES_OPTION,
  storeIsSetUp,
  storefrontUpgrader,
  upgradeStorefront,
} from "../../src/features/store-shell/storefront-upgrades.js";

const options = { includeContent: true, onConflict: "skip", skipMediaDownload: true } as const;
const ALL = STOREFRONT_UPGRADES.map((upgrade) => upgrade.name);

// template-store-self-upgrade-20261028: a running store takes the template's newer schema itself.
describe("storefront upgrades a store runs on its own", () => {
  let db: Kysely<never>;
  const recorded = () => new OptionsRepository(db as never).get(STOREFRONT_UPGRADES_OPTION);
  const products = async () => Object.fromEntries((await sql<{ slug: string; required: number; label: string }>`
    select f.slug, f.required, f.label from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
    where c.slug = 'products'`.execute(db)).rows.map((row) => [row.slug, row]));
  const groups = async () => Object.fromEntries((await sql<{ slug: string; nav_group: string | null }>`
    select slug, nav_group from _emdash_collections`.execute(db)).rows.map((row) => [row.slug, row.nav_group]));
  const pageAddress = async () => (await sql<{ url_pattern: string | null }>`
    select url_pattern from _emdash_collections where slug = 'pages'`.execute(db)).rows[0]?.url_pattern;

  beforeEach(async () => {
    db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    await runMigrations(db as never);
    // A store set up from the older apparel-only seed, as the beta store was.
    await applySeed(db as never, JSON.parse(readFileSync("tests/fixtures/seed-before-product-categories.json", "utf8")), options);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  it("runs each upgrade an older store hasn't run, in order, records it, and then runs none", async () => {
    expect(await recorded()).toBeNull();
    expect((await products()).visual_label?.required).toBe(1);

    expect(await upgradeStorefront(db)).toEqual(["001_storefront_search", "002_product_fields", "003_page_addresses", "004_category_products", "005_commerce_box_off", "006_store_folder", "007_start_in_staging"]);
    expect(await recorded()).toEqual(ALL);
    // template-site-visibility-20261122: an upgraded store that never chose starts in staging.
    expect((await sql<{ value: string }>`select value from options where name = 'site:staging'`.execute(db)).rows[0]?.value).toBe("true");
    const after = await products();
    expect(after.visual_label).toMatchObject({ required: 0, label: VISUAL_LABEL_FIELD_LABEL });
    expect(after.summary && after.details).toBeTruthy();
    // The seed's demonstrations name no Commerce product, so the box comes off.
    expect(after.commerce_item_id).toBeUndefined();
    expect(await pageAddress()).toBe(PAGE_URL_PATTERN);
    // admin-one-store-folder-128: the catalog joins the Store folder; Pages stays inline.
    expect(await groups()).toMatchObject({ products: STORE_FOLDER_GROUP, categories: STORE_FOLDER_GROUP, pages: null });

    // Recorded steps never run again, so an owner's later change stays.
    await sql`update _emdash_collections set url_pattern = null where slug = 'pages'`.execute(db);
    expect(await upgradeStorefront(db)).toEqual([]);
    expect(await pageAddress()).toBeNull();
  });

  it("keeps a folder the owner already gave a collection", async () => {
    await sql`update _emdash_collections set nav_group = 'Catalog' where slug = 'categories'`.execute(db);
    await upgradeStorefront(db);
    expect(await groups()).toMatchObject({ products: STORE_FOLDER_GROUP, categories: "Catalog" });
    // Running it again, as pnpm search:upgrade does, changes nothing.
    await upgradeStorefront(db, { all: true });
    expect(await groups()).toMatchObject({ products: STORE_FOLDER_GROUP, categories: "Catalog" });
  });

  it("keeps the Live or staging choice an older store's owner already saved", async () => {
    const staging = async () => (await sql<{ value: string }>`select value from options where name = 'site:staging'`.execute(db)).rows[0]?.value;
    const options = new OptionsRepository(db as never);
    // The owner pressed Go live before this upgrade ran.
    await options.set("site:staging", false);
    await upgradeStorefront(db);
    expect(await staging()).toBe("false");
    // Switched back to staging, then every step run again (pnpm search:upgrade): still staging.
    await options.set("site:staging", true);
    await upgradeStorefront(db, { all: true });
    expect(await staging()).toBe("true");
    // And Live again stays Live through a full rerun.
    await options.set("site:staging", false);
    await upgradeStorefront(db, { all: true });
    expect(await staging()).toBe("false");
  });

  it("stops at a failed step without recording it, and the next run starts from that step", async () => {
    const order: string[] = [];
    let fail = true;
    const upgrades = [
      { name: "a", run: async () => { order.push("a"); } },
      { name: "b", run: async () => { order.push("b"); if (fail) throw new Error("D1 was busy"); } },
      { name: "c", run: async () => { order.push("c"); } },
    ];
    await expect(upgradeStorefront(db, { upgrades })).rejects.toThrow("D1 was busy");
    expect(await recorded()).toEqual(["a"]);
    fail = false;
    expect(await upgradeStorefront(db, { upgrades })).toEqual(["b", "c"]);
    expect(order).toEqual(["a", "b", "b", "c"]);
    expect(await recorded()).toEqual(["a", "b", "c"]);
    // pnpm search:upgrade reruns every step to repair a local database.
    expect(await upgradeStorefront(db, { upgrades, all: true })).toEqual(["a", "b", "c"]);
  });

  it("upgrades once per isolate, never fails the request, waits before trying again, and stays off when EmDash migrations are manual", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    await new OptionsRepository(db as never).set("emdash:setup_complete", true);
    const upgrade = storefrontUpgrader(60_000);
    let opened = 0;
    let broken = true;
    const open = async () => {
      opened += 1;
      if (broken) throw new Error("no database yet");
      return db;
    };

    await upgrade(open, { mode: "manual", now: 0 });
    await upgrade(open, { mode: "check", now: 0 });
    expect(opened).toBe(0);

    await expect(upgrade(open, { now: 1_000 })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    await upgrade(open, { now: 30_000 });
    expect(opened).toBe(1);

    broken = false;
    // Requests that arrive together share one run.
    await Promise.all([upgrade(open, { now: 61_000 }), upgrade(open, { now: 61_000 })]);
    expect(opened).toBe(2);
    expect(await recorded()).toEqual(ALL);
    await upgrade(open, { now: 200_000 });
    expect(opened).toBe(2);
  });

  it("leaves a store EmDash hasn't seeded and nobody has set up until one of them has", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const options = new OptionsRepository(db as never);
    const upgrade = storefrontUpgrader(60_000);
    const open = async () => db;

    expect(await storeIsSetUp(db)).toBe(false);
    await upgrade(open, { now: 0 });
    expect(await recorded()).toBeNull();
    expect((await products()).visual_label?.required).toBe(1);
    // A store EmDash seeded on its first request is ready, even before its owner finishes setup.
    await options.set("emdash:seed_complete", true);
    await upgrade(open, { now: 30_000 });
    expect(await recorded()).toBeNull();
    expect(await storeIsSetUp(db)).toBe(true);
    await upgrade(open, { now: 60_000 });
    expect(await recorded()).toEqual(ALL);
  });
});

describe("a fresh store from the current seed", () => {
  it("starts with Products and Product categories in the Store folder, so 006 has nothing to do", async () => {
    const db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    try {
      await runMigrations(db as never);
      await applySeed(db as never, JSON.parse(readFileSync("seed/seed.json", "utf8")), options);
      const rows = (await sql<{ slug: string; nav_group: string | null }>`
        select slug, nav_group from _emdash_collections order by slug`.execute(db)).rows;
      expect(Object.fromEntries(rows.map((row) => [row.slug, row.nav_group]))).toMatchObject({
        products: STORE_FOLDER_GROUP,
        categories: STORE_FOLDER_GROUP,
        pages: null,
      });
    } finally {
      await db.destroy();
    }
  });
});
