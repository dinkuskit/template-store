import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Kysely, sql } from "kysely";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed } from "emdash/seed";
import {
  ADDED_PRODUCT_BLOCK_TYPES,
  ADDED_PRODUCT_FIELDS,
  CATEGORY_PRODUCTS_FIELD,
  COMMERCE_PRODUCT_FIELD,
  PAGE_URL_PATTERN,
  VISUAL_LABEL_FIELD_LABEL,
  ensureStorefrontCategoryProducts,
  ensureStorefrontPageAddresses,
  ensureStorefrontProductFields,
  removeStorefrontCommerceBox,
} from "../../src/features/store-shell/product-schema-upgrade.js";

const options = { includeContent: true, onConflict: "skip", skipMediaDownload: true } as const;
const seedNow = () => JSON.parse(readFileSync("seed/seed.json", "utf8"));

describe("storefront product schema upgrade (template-sells-anything-20261027)", () => {
  let db: Kysely<never>;
  const fields = async () => Object.fromEntries((await sql<{ slug: string; required: number; label: string; type: string }>`
    select f.slug, f.required, f.label, f.type from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
    where c.slug = 'products'`.execute(db)).rows.map((row) => [row.slug, row]));

  beforeEach(async () => {
    db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    await runMigrations(db as never);
    // A store set up from the older apparel-only seed.
    await applySeed(db as never, JSON.parse(readFileSync("tests/fixtures/seed-before-product-categories.json", "utf8")), options);
  });
  afterEach(async () => { await db.destroy(); });

  it("mirrors the seed's new product fields", () => {
    const seeded = seedNow().collections.find((collection: { slug: string }) => collection.slug === "products").fields;
    for (const field of ADDED_PRODUCT_FIELDS) {
      expect(seeded.find((entry: { slug: string }) => entry.slug === field.slug)).toEqual(field);
    }
    expect(seeded.find((entry: { slug: string }) => entry.slug === "visual_label")).toEqual({ slug: "visual_label", label: VISUAL_LABEL_FIELD_LABEL, type: "string" });
    const categoryFields = seedNow().collections.find((collection: { slug: string }) => collection.slug === "categories").fields;
    expect(categoryFields.find((entry: { slug: string }) => entry.slug === CATEGORY_PRODUCTS_FIELD.slug)).toEqual(CATEGORY_PRODUCTS_FIELD);
    const seededBlocks = seedNow().blockTypes;
    for (const blockType of ADDED_PRODUCT_BLOCK_TYPES) {
      expect(seededBlocks.find((entry: { slug: string }) => entry.slug === blockType.slug)).toEqual(blockType);
    }
  });

  // `pnpm search:upgrade` runs only the upgrade, with no re-seed, so these tests do too.
  it("drops the old required placeholder art and adds summary, details and their block types with no re-seed", async () => {
    const blockTypes = async () => (await sql<{ slug: string }>`select slug from _emdash_block_types order by slug`.execute(db)).rows.map((row) => row.slug);
    expect((await fields()).visual_label?.required).toBe(1);
    expect((await fields()).summary).toBeUndefined();
    expect(await blockTypes()).toEqual(["home_opener", "query_card", "rich_text"]);

    await ensureStorefrontProductFields(db);
    const after = await fields();
    expect(after.visual_label).toMatchObject({ required: 0, label: VISUAL_LABEL_FIELD_LABEL });
    expect(after.summary?.type).toBe("portableText");
    expect(after.details?.type).toBe("blocks");
    expect(await blockTypes()).toEqual(["collapsible_section", "home_opener", "query_card", "rich_text", "spec_table"]);
    expect((await sql<{ slug: string }>`
      select t.slug from _emdash_block_types t join _emdash_block_type_versions v on v.block_type_id = t.id and v.version = t.current_version
      where t.slug in ('collapsible_section', 'spec_table') order by t.slug`.execute(db)).rows.map((row) => row.slug)).toEqual(["collapsible_section", "spec_table"]);

    // Re-running changes nothing, and a merchant's own labels survive.
    await sql`update _emdash_fields set label = 'Art' where slug = 'visual_label'`.execute(db);
    await sql`update _emdash_block_types set label = 'Specs' where slug = 'spec_table'`.execute(db);
    await ensureStorefrontProductFields(db);
    expect((await fields()).visual_label).toMatchObject({ required: 0, label: "Art" });
    expect((await sql<{ label: string }>`select label from _emdash_block_types where slug = 'spec_table'`.execute(db)).rows[0]?.label).toBe("Specs");
  });

  // A store set up before template-store#118, as the beta store was, has categories without their products list.
  it("gives an older store's categories their products list, keeping the collection's label", async () => {
    const categoryFields = async () => (await sql<{ slug: string; label: string; type: string; validation: string | null }>`
      select f.slug, f.label, f.type, f.validation from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
      where c.slug = 'categories' order by f.sort_order, f.slug`.execute(db)).rows;
    const collectionLabel = async () => (await sql<{ label: string }>`
      select label from _emdash_collections where slug = 'categories'`.execute(db)).rows[0]?.label;
    const links = async () => (await sql<{ parent_group: string; child_group: string }>`
      select r.parent_group, r.child_group from _emdash_content_references r join _emdash_relations rel on rel.id = r.relation_id
      where rel.slug = 'product_categories' order by r.parent_group, r.child_group`.execute(db)).rows;
    expect((await categoryFields()).map((field) => field.slug)).toEqual(["title", "description"]);
    const linked = await links();
    expect(linked.length).toBeGreaterThan(0);

    await ensureStorefrontCategoryProducts(db);
    const products = (await categoryFields()).find((field) => field.slug === "products");
    expect(products).toMatchObject({ label: "Products in this category", type: "reference" });
    expect(JSON.parse(products?.validation ?? "{}")).toEqual({ relation: "product_categories", relationSide: "parent", targetCollection: "products" });
    expect(await collectionLabel()).toBe("Categories");
    expect(await links()).toEqual(linked);

    // Stored as a fresh store's seed stores it.
    const fresh = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    try {
      await runMigrations(fresh as never);
      await applySeed(fresh as never, seedNow(), options);
      const seeded = (await sql<{ label: string; type: string; validation: string | null; required: number; widget: string | null; options: string | null }>`
        select f.label, f.type, f.validation, f.required, f.widget, f.options from _emdash_fields f
        join _emdash_collections c on c.id = f.collection_id where c.slug = 'categories' and f.slug = 'products'`.execute(fresh)).rows[0];
      const upgraded = (await sql<{ label: string; type: string; validation: string | null; required: number; widget: string | null; options: string | null }>`
        select f.label, f.type, f.validation, f.required, f.widget, f.options from _emdash_fields f
        join _emdash_collections c on c.id = f.collection_id where c.slug = 'categories' and f.slug = 'products'`.execute(db)).rows[0];
      expect(seeded).toBeDefined();
      expect({ ...upgraded, validation: JSON.parse(upgraded?.validation ?? "{}") }).toEqual({ ...seeded, validation: JSON.parse(seeded?.validation ?? "{}") });
    } finally {
      await fresh.destroy();
    }

    // Re-running changes nothing, and a merchant's own label survives.
    await sql`update _emdash_fields set label = 'In this aisle' where slug = 'products'
      and collection_id = (select id from _emdash_collections where slug = 'categories')`.execute(db);
    await ensureStorefrontCategoryProducts(db);
    expect((await categoryFields()).filter((field) => field.slug === "products")).toMatchObject([{ label: "In this aisle" }]);
  });

  it("leaves categories that already pick products through the relation as they are", async () => {
    await sql`insert into _emdash_fields (id, collection_id, slug, label, type, column_type, validation, sort_order)
      select 'own-picker', id, 'stock', 'Stocked items', 'reference', 'TEXT',
        '{"relation":"product_categories","relationSide":"parent","targetCollection":"products"}', 9
      from _emdash_collections where slug = 'categories'`.execute(db);
    await ensureStorefrontCategoryProducts(db);
    expect((await sql<{ slug: string }>`
      select f.slug from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
      where c.slug = 'categories' and f.type = 'reference'`.execute(db)).rows.map((row) => row.slug)).toEqual(["stock"]);
  });

  it("leaves a store without the product_categories relation as it is", async () => {
    await sql`delete from _emdash_relations where slug = 'product_categories'`.execute(db);
    await ensureStorefrontCategoryProducts(db);
    expect((await sql<{ slug: string }>`
      select f.slug from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
      where c.slug = 'categories' and f.slug = 'products'`.execute(db)).rows).toEqual([]);
  });

  it("keeps every existing product's saved values", async () => {
    // Every column the older store already had, read before the upgrade adds any.
    const columns = (await sql<{ name: string }>`select name from pragma_table_info('ec_products')`.execute(db)).rows.map((row) => `"${row.name}"`).join(", ");
    const products = async () => (await sql.raw<Record<string, unknown>>(`select ${columns} from ec_products order by id`).execute(db)).rows;
    const before = await products();
    expect(before.length).toBeGreaterThan(0);
    await ensureStorefrontProductFields(db);
    await ensureStorefrontPageAddresses(db);
    await ensureStorefrontCategoryProducts(db);
    expect(await products()).toEqual(before);
  });

  // template-cms-pages-and-redirects-20261027
  it("gives older Pages an address and adds the WooCommerce starter redirects on re-seed", async () => {
    const pageAddress = async () => (await sql<{ url_pattern: string | null }>`
      select url_pattern from _emdash_collections where slug = 'pages'`.execute(db)).rows[0]?.url_pattern;
    expect(seedNow().collections.find((collection: { slug: string }) => collection.slug === "pages").urlPattern).toBe(PAGE_URL_PATTERN);
    await applySeed(db as never, seedNow(), options);
    expect(await pageAddress()).toBeNull();
    const redirects = (await sql<{ source: string; destination: string; type: number }>`
      select source, destination, type from _emdash_redirects order by source`.execute(db)).rows;
    expect(redirects).toEqual([
      { source: "/product-category/[slug]", destination: "/categories/[slug]", type: 301 },
      { source: "/product/[slug]", destination: "/products/[slug]", type: 301 },
    ]);

    await ensureStorefrontPageAddresses(db);
    expect(await pageAddress()).toBe(PAGE_URL_PATTERN);
    // An address the owner chose is kept.
    await sql`update _emdash_collections set url_pattern = '/info/{slug}' where slug = 'pages'`.execute(db);
    await ensureStorefrontPageAddresses(db);
    expect(await pageAddress()).toBe("/info/{slug}");
  });

  // template-drop-older-store-box-20261101: Commerce holds a page's product and the store never reads the box,
  // so it comes off whatever it still says.
  describe("taking the Commerce product box off", () => {
    const store = (plugin: string, collection: string, id: string, data: unknown = {}) =>
      sql`insert into _plugin_storage (plugin_id, collection, id, data) values (${plugin}, ${collection}, ${id}, ${JSON.stringify(data)})`.execute(db);
    const hasBox = async () => (await fields())[COMMERCE_PRODUCT_FIELD] !== undefined;

    it("is no longer in the seed", () => {
      const seeded = seedNow().collections.find((collection: { slug: string }) => collection.slug === "products").fields;
      expect(seeded.map((field: { slug: string }) => field.slug)).not.toContain(COMMERCE_PRODUCT_FIELD);
      for (const entry of seedNow().content.products) expect(entry.data).not.toHaveProperty(COMMERCE_PRODUCT_FIELD);
    });

    it("comes off at once, even while a page's box names a Commerce product Commerce links to no page", async () => {
      await sql`update ec_products set commerce_item_id = ' 123 ' where slug = 'canvas-cap'`.execute(db);
      await store("r_fjzjvld3ssb4j63o", "catalog_items", "123", { name: "Ryan Test Hat" });
      await sql`insert into _plugin_state (plugin_id, version, status, source) values ('r_fjzjvld3ssb4j63o', '0.7.0-beta.2', 'active', 'registry')`.execute(db);
      await expect(removeStorefrontCommerceBox(db)).resolves.toBeUndefined();
      expect(await hasBox()).toBe(false);
      expect((await sql<{ name: string }>`select name from pragma_table_info('ec_products')`.execute(db)).rows.map((row) => row.name)).not.toContain(COMMERCE_PRODUCT_FIELD);
      // The page and Commerce's product are kept; only the box is gone.
      expect((await sql<{ n: number }>`select count(*) as n from ec_products where slug = 'canvas-cap'`.execute(db)).rows[0]!.n).toBe(1);
      expect((await sql<{ n: number }>`select count(*) as n from _plugin_storage where id = '123'`.execute(db)).rows[0]!.n).toBe(1);
      // A store without the box is left as it is.
      await expect(removeStorefrontCommerceBox(db)).resolves.toBeUndefined();
    });
  });
});
