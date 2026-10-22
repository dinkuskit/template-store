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
 * Idempotently upgrades existing `pages`, `products`, and `categories`
 * collection definitions and searchable fields so stores initialized from an
 * older seed gain FTS5 search support without overwriting merchant-edited
 * collection labels, field definitions, or content.
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

    let schemaChanged = false;
    const supports = parseSupportsList(collectionRow.supports);
    if (!supports.includes("search")) {
      const nextSupports = JSON.stringify([...supports, "search"]);
      await sql`
        update _emdash_collections
        set supports = ${nextSupports}
        where id = ${collectionRow.id}
      `.execute(db);
      schemaChanged = true;
    }

    for (const fieldSlug of fieldSlugs) {
      const updated = await sql`
        update _emdash_fields
        set searchable = 1
        where collection_id = ${collectionRow.id}
          and slug = ${fieldSlug}
          and coalesce(searchable, 0) = 0
      `.execute(db);
      if (Number(updated.numAffectedRows ?? 0) > 0) {
        schemaChanged = true;
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
