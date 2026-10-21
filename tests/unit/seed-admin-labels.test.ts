import { readFileSync } from "node:fs";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed } from "emdash/seed";
import { Kysely, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: Kysely<never>;
beforeEach(async () => {
  db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
  await runMigrations(db as never);
  const seed = JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf8"));
  await applySeed(db as never, seed, { includeContent: true, onConflict: "skip", skipMediaDownload: true });
});
afterEach(async () => { await db.destroy(); });

describe("seeded admin labels", () => {
  it("names the category collection for products and EmDash's own blog taxonomy for posts", async () => {
    const collection = (await sql<{ label: string; label_singular: string }>`
      select label, label_singular from _emdash_collections where slug = 'categories'`.execute(db)).rows[0];
    expect(collection).toMatchObject({ label: "Product categories", label_singular: "Product category" });
    const taxonomy = (await sql<{ label: string }>`
      select label from _emdash_taxonomy_defs where name = 'category'`.execute(db)).rows[0];
    expect(taxonomy?.label).toBe("Post categories");
  });

  it("shows a category's products on the category editor through the product_categories relation", async () => {
    const fields = (await sql<{ slug: string; validation: string }>`
      select f.slug, f.validation from _emdash_fields f
      join _emdash_collections c on c.id = f.collection_id
      where c.slug = 'categories' and f.type = 'reference'`.execute(db)).rows;
    expect(fields).toHaveLength(1);
    expect(fields[0]?.slug).toBe("products");
    expect(JSON.parse(fields[0]!.validation)).toMatchObject({
      relation: "product_categories",
      relationSide: "parent",
      targetCollection: "products",
    });
    const hats = (await sql<{ products: number }>`
      select count(*) as products from _emdash_content_references r
      join _emdash_relations rel on rel.id = r.relation_id
      join ec_categories c on coalesce(c.translation_group, c.id) = r.parent_group
      where rel.slug = 'product_categories' and c.slug = 'hats'`.execute(db)).rows[0];
    expect(Number(hats?.products)).toBe(2);
  });
});

describe("re-seeding a populated store from before the product-category labels", () => {
  let existing: Kysely<never>;
  const seedNow = () => JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf8"));
  const show = async () => ({
    collection: (await sql<{ label: string }>`select label from _emdash_collections where slug = 'categories'`.execute(existing)).rows[0]?.label,
    taxonomies: Object.fromEntries((await sql<{ name: string; label: string }>`select name, label from _emdash_taxonomy_defs`.execute(existing)).rows.map((row) => [row.name, row.label])),
    categoryFields: (await sql<{ slug: string }>`
      select f.slug from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
      where c.slug = 'categories' order by f.slug`.execute(existing)).rows.map((row) => row.slug),
    hats: (await sql<{ title: string }>`select title from ec_categories where slug = 'hats'`.execute(existing)).rows[0]?.title,
    links: Number((await sql<{ n: number }>`select count(*) as n from _emdash_content_references`.execute(existing)).rows[0]?.n),
  });

  beforeEach(async () => {
    existing = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    await runMigrations(existing as never);
    // The seed as it was on main before this change, applied with its content.
    const before = JSON.parse(readFileSync(new URL("../fixtures/seed-before-product-categories.json", import.meta.url), "utf8"));
    await applySeed(existing as never, before, { includeContent: true, onConflict: "skip", skipMediaDownload: true });
    // Merchant edits made after setup.
    await sql`update ec_categories set title = 'Caps & Hats' where slug = 'hats'`.execute(existing);
    await sql`update _emdash_taxonomy_defs set label = 'Journal topics' where name = 'tag'`.execute(existing);
  });
  afterEach(async () => { await existing.destroy(); });

  it("keeps merchant edits, taxonomy settings and category links on the default skip re-seed", async () => {
    const before = await show();
    await applySeed(existing as never, seedNow(), { includeContent: true, onConflict: "skip", skipMediaDownload: true });
    const after = await show();
    expect(after.hats).toBe("Caps & Hats");
    expect(after.links).toBe(before.links);
    expect(after.links).toBe(5);
    expect(after.taxonomies.tag).toBe("Journal topics");
    // An existing store keeps its collection label and fields; only EmDash's
    // untouched built-in posts taxonomy picks up the clearer name.
    expect(after.collection).toBe("Categories");
    expect(after.categoryFields).toEqual(before.categoryFields);
    expect(after.taxonomies.category).toBe("Post categories");
  });

  it("leaves a merchant-renamed built-in taxonomy alone", async () => {
    await sql`update _emdash_taxonomy_defs set label = 'Blog sections' where name = 'category'`.execute(existing);
    await applySeed(existing as never, seedNow(), { includeContent: true, onConflict: "skip", skipMediaDownload: true });
    expect((await show()).taxonomies.category).toBe("Blog sections");
  });
});
