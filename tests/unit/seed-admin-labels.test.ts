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
