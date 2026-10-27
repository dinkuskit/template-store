import { SchemaRegistry, type CreateFieldInput } from "emdash";
import { sql, type Kysely } from "kysely";

/** The seed's old label for the placeholder-art field, replaced only while a store still has it. */
const LEGACY_VISUAL_LABEL = "Illustration style (TEE, HOODIE, CAP, or BEANIE)";
export const VISUAL_LABEL_FIELD_LABEL = "Placeholder art (optional, used only when Commerce has no image)";

/** Product fields added after first setup; they mirror seed/seed.json (template-rich-product-page-20261027). */
export const ADDED_PRODUCT_FIELDS: readonly CreateFieldInput[] = [
  { slug: "summary", label: "Summary (shown beside the price)", type: "portableText", searchable: true },
  {
    slug: "details",
    label: "Product details (sections below the price)",
    type: "blocks",
    validation: { allowedTypes: ["collapsible_section", "spec_table", "rich_text"], maxItems: 30 },
  },
];

/**
 * Brings a store set up from an older seed to the current products schema.
 * A skip re-seed never touches an existing collection's fields, so without this
 * an older store would keep demanding apparel placeholder art and never gain
 * the summary and details fields (template-sells-anything-20261027).
 * Run it after the seed so the details field's block types exist. Merchant
 * label edits and content are left alone; re-running changes nothing.
 */
export async function ensureStorefrontProductFields(db: unknown): Promise<void> {
  const kyselyDb = db as Kysely<never>;
  const registry = new SchemaRegistry(kyselyDb as never);
  if (!(await registry.getCollection("products"))) return;
  // EmDash refuses to change `required` through its schema API without a content
  // migration; dropping it needs none, since no saved entry can become invalid.
  await sql`
    update _emdash_fields
    set required = 0,
        label = case when label = ${LEGACY_VISUAL_LABEL} then ${VISUAL_LABEL_FIELD_LABEL} else label end
    where slug = 'visual_label'
      and collection_id = (select id from _emdash_collections where slug = 'products')
  `.execute(kyselyDb);
  for (const field of ADDED_PRODUCT_FIELDS) {
    if (!(await registry.getField("products", field.slug))) await registry.createField("products", field);
  }
}

/** The address of a published CMS page, matching src/pages/[slug].astro and seed/seed.json. */
export const PAGE_URL_PATTERN = "/{slug}";

/**
 * Gives an older store's Pages their storefront address, so the admin links to
 * each page and EmDash adds a redirect when a page's slug changes
 * (template-cms-pages-and-redirects-20261027). An address the owner already set is kept.
 */
export async function ensureStorefrontPageAddresses(db: unknown): Promise<void> {
  const registry = new SchemaRegistry(db as never);
  const pages = await registry.getCollection("pages");
  if (pages && !pages.urlPattern) await registry.updateCollection("pages", { urlPattern: PAGE_URL_PATTERN });
}
