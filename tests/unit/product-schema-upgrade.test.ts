import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Kysely, sql } from "kysely";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed } from "emdash/seed";
import {
  ADDED_PRODUCT_BLOCK_TYPES,
  ADDED_PRODUCT_FIELDS,
  PAGE_URL_PATTERN,
  VISUAL_LABEL_FIELD_LABEL,
  ensureStorefrontPageAddresses,
  ensureStorefrontProductFields,
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

  it("keeps every existing product's saved values", async () => {
    // Every column the older store already had, read before the upgrade adds any.
    const columns = (await sql<{ name: string }>`select name from pragma_table_info('ec_products')`.execute(db)).rows.map((row) => `"${row.name}"`).join(", ");
    const products = async () => (await sql.raw<Record<string, unknown>>(`select ${columns} from ec_products order by id`).execute(db)).rows;
    const before = await products();
    expect(before.length).toBeGreaterThan(0);
    await ensureStorefrontProductFields(db);
    await ensureStorefrontPageAddresses(db);
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
});
