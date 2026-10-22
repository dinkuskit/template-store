import { FTSManager } from "emdash";
import { sql, type Kysely } from "kysely";

export const STOREFRONT_SEARCHABLE_COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  pages: ["title", "content"],
  products: ["title", "description", "visual_label"],
  categories: ["title", "description"],
};

function parseSupportsList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Upgrades legacy `pages`, `products`, and `categories` collection definitions
 * that predated storefront FTS5 search (`!supports.includes("search")`), while
 * preserving merchant-configured field search exclusions (`searchable = 0`)
 * once search support has been initialized on a collection.
 */
export async function ensureStorefrontSearchSupport(db: Kysely<never>): Promise<void> {
  const ftsManager = new FTSManager(db as never);
  for (const [slug, fieldSlugs] of Object.entries(STOREFRONT_SEARCHABLE_COLLECTIONS)) {
    const collectionRow = (
      await sql<{ id: string; supports: string | null }>`
        select id, supports from _emdash_collections where slug = ${slug}
      `.execute(db)
    ).rows[0];
    if (!collectionRow) continue;

    const supports = parseSupportsList(collectionRow.supports);
    const alreadySupportsSearch = supports.includes("search");
    let schemaChanged = false;

    if (!alreadySupportsSearch) {
      const nextSupports = JSON.stringify([...supports, "search"]);
      await sql`
        update _emdash_collections
        set supports = ${nextSupports}
        where id = ${collectionRow.id}
      `.execute(db);
      schemaChanged = true;

      // Only seed default searchable fields when upgrading a legacy collection
      // that did not yet declare `"search"` in `_emdash_collections.supports`.
      // Subsequent runs preserve merchant field exclusions (`searchable = 0`).
      const existingSearchableCount = Number(
        (
          await sql<{ n: number }>`
            select count(*) as n
            from _emdash_fields
            where collection_id = ${collectionRow.id}
              and coalesce(searchable, 0) = 1
          `.execute(db)
        ).rows[0]?.n ?? 0,
      );

      if (existingSearchableCount === 0) {
        for (const fieldSlug of fieldSlugs) {
          await sql`
            update _emdash_fields
            set searchable = 1
            where collection_id = ${collectionRow.id}
              and slug = ${fieldSlug}
          `.execute(db);
        }
      }
    }

    const ftsTableName = `_emdash_fts_${slug}`;
    const existingFts = (
      await sql<{ name: string }>`
        select name from sqlite_master where type = 'table' and name = ${ftsTableName}
      `.execute(db)
    ).rows[0];

    if (schemaChanged || !existingFts) {
      const searchableFields = await ftsManager.getSearchableFields(slug);
      if (searchableFields.length > 0) {
        await ftsManager.enableSearch(slug);
      }
    }
  }
}
