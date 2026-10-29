import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kysely, sql } from "kysely";
import { OptionsRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed } from "emdash/seed";
import { PAGE_URL_PATTERN, VISUAL_LABEL_FIELD_LABEL } from "../../src/features/store-shell/product-schema-upgrade.js";
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

    expect(await upgradeStorefront(db)).toEqual(["001_storefront_search", "002_product_fields", "003_page_addresses", "004_category_products", "005_commerce_box_off"]);
    expect(await recorded()).toEqual(ALL);
    const after = await products();
    expect(after.visual_label).toMatchObject({ required: 0, label: VISUAL_LABEL_FIELD_LABEL });
    expect(after.summary && after.details).toBeTruthy();
    // The seed's demonstrations name no Commerce product, so the box comes off.
    expect(after.commerce_item_id).toBeUndefined();
    expect(await pageAddress()).toBe(PAGE_URL_PATTERN);

    // Recorded steps never run again, so an owner's later change stays.
    await sql`update _emdash_collections set url_pattern = null where slug = 'pages'`.execute(db);
    expect(await upgradeStorefront(db)).toEqual([]);
    expect(await pageAddress()).toBeNull();
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

  it("leaves a waiting step unrecorded, runs the steps after it, and records it once it runs", async () => {
    let wait = true;
    const upgrades = [
      { name: "a", run: async () => {} },
      { name: "b", run: async () => (wait ? "wait" as const : undefined) },
      { name: "c", run: async () => {} },
    ];
    const waiting: string[] = [];
    expect(await upgradeStorefront(db, { upgrades, waiting })).toEqual(["a", "c"]);
    expect(waiting).toEqual(["b"]);
    expect(await recorded()).toEqual(["a", "c"]);
    wait = false;
    expect(await upgradeStorefront(db, { upgrades })).toEqual(["b"]);
    expect(await recorded()).toEqual(["a", "c", "b"]);
  });

  it("tries a waiting step again later, after the wait, and then stops", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await new OptionsRepository(db as never).set("emdash:setup_complete", true);
    // A live page whose box names a real Commerce product that Commerce doesn't link to it yet.
    const cap = (await sql<{ id: string }>`select id from ec_products where slug = 'canvas-cap'`.execute(db)).rows[0]!.id;
    await sql`update ec_products set commerce_item_id = '123' where id = ${cap}`.execute(db);
    await sql`insert into _plugin_storage (plugin_id, collection, id, data) values ('dinkus-commerce', 'catalogItems', '123', '{}')`.execute(db);
    const upgrade = storefrontUpgrader(60_000, 900_000);
    let opened = 0;
    const open = async () => { opened += 1; return db; };

    await upgrade(open, { now: 0 });
    expect(await recorded()).toEqual(ALL.filter((name) => name !== "005_commerce_box_off"));
    expect((await products()).commerce_item_id).toBeDefined();
    await upgrade(open, { now: 600_000 });
    expect(opened).toBe(1);

    await sql`insert into _plugin_storage (plugin_id, collection, id, data) values ('dinkus-commerce', 'product_pages', ${`e:${cap}`}, '{}')`.execute(db);
    await upgrade(open, { now: 900_000 });
    expect(opened).toBe(2);
    expect(await recorded()).toContain("005_commerce_box_off");
    expect((await products()).commerce_item_id).toBeUndefined();
    await upgrade(open, { now: 2_000_000 });
    expect(opened).toBe(2);
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
