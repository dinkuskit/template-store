import { BlockTypeRegistry, SchemaRegistry, type ApplySeedBlockTypeInput, type CreateFieldInput } from "emdash";
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

/** Block types the details field allows that an older seed never made; they mirror seed/seed.json. */
export const ADDED_PRODUCT_BLOCK_TYPES: readonly ApplySeedBlockTypeInput[] = [
  {
    slug: "collapsible_section",
    label: "Collapsible section",
    category: "Content",
    currentVersion: 1,
    versions: [{
      version: 1,
      fields: [
        { slug: "heading", label: "Heading", type: "string", required: true },
        { slug: "content", label: "Content", type: "portableText" },
        { slug: "open_by_default", label: "Open by default", type: "boolean" },
      ],
    }],
  },
  {
    slug: "spec_table",
    label: "Specification table",
    category: "Content",
    currentVersion: 1,
    versions: [{
      version: 1,
      fields: [
        { slug: "heading", label: "Heading", type: "string" },
        {
          slug: "rows",
          label: "Rows",
          type: "repeater",
          validation: {
            subFields: [
              { slug: "label", label: "Label", type: "string", required: true },
              { slug: "value", label: "Value", type: "string", required: true },
            ],
          },
        },
      ],
    }],
  },
];

/**
 * Brings a store set up from an older seed to the current products schema.
 * A skip re-seed never touches an existing collection's fields, so without this
 * an older store would keep demanding apparel placeholder art and never gain
 * the summary and details fields (template-sells-anything-20261027).
 * It makes the details field's missing block types first, so it needs no
 * re-seed. Merchant label edits, block types and content are left alone;
 * re-running changes nothing.
 */
export async function ensureStorefrontProductFields(db: unknown): Promise<void> {
  const kyselyDb = db as Kysely<never>;
  const registry = new SchemaRegistry(kyselyDb as never);
  if (!(await registry.getCollection("products"))) return;
  const blockTypes = new BlockTypeRegistry(kyselyDb as never);
  for (const blockType of ADDED_PRODUCT_BLOCK_TYPES) await blockTypes.applySeedBlockType(blockType, "skip");
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

/** The category field that lists its products; it mirrors seed/seed.json (template-store#118). */
export const CATEGORY_PRODUCTS_FIELD: CreateFieldInput = {
  slug: "products",
  label: "Products in this category",
  type: "reference",
  validation: { relation: "product_categories", relationSide: "parent" },
};

/**
 * Gives a store set up before template-store#118 its category editor's
 * "Products in this category" list, through the product_categories relation
 * the store already has, so existing product links show at once. A skip
 * re-seed never adds it. The collection's own label is left alone, as #118
 * left it; a store without the categories collection or the relation, or with
 * the field already, is not changed. Neither is one whose categories already
 * have another field picking products through the relation, since EmDash lets
 * only one field view a relation from each end.
 *
 * The field is stored with the collection it lists, which EmDash's seed and its
 * schema API both work out from the relation. The editor's product list and the
 * site's reference reads skip a reference field without it.
 */
export async function ensureStorefrontCategoryProducts(db: unknown): Promise<void> {
  const kyselyDb = db as Kysely<never>;
  const registry = new SchemaRegistry(kyselyDb as never);
  const categories = await registry.getCollectionWithFields("categories");
  if (!categories || categories.fields.some((field) => field.slug === CATEGORY_PRODUCTS_FIELD.slug)) return;
  const relationSlug = CATEGORY_PRODUCTS_FIELD.validation!.relation;
  const relation = (await sql<{ child_collection: string }>`
    select child_collection from _emdash_relations
    where slug = ${relationSlug} and parent_collection = 'categories'`.execute(kyselyDb)).rows[0];
  if (!relation) return;
  const picked = categories.fields.some((field) => field.type === "reference"
    && field.validation?.relation === relationSlug && field.validation?.relationSide !== "child");
  if (picked) return;
  await registry.createField("categories", {
    ...CATEGORY_PRODUCTS_FIELD,
    validation: { ...CATEGORY_PRODUCTS_FIELD.validation, targetCollection: relation.child_collection },
  });
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

/** The products field older seeds made for the Commerce product a page sells (template-no-commerce-box-20261029). */
export const COMMERCE_PRODUCT_FIELD = "commerce_item_id";

/**
 * Takes the Commerce product box off a store set up from an older seed. Commerce
 * holds which page sells which product (template-no-commerce-box-20261029), and
 * the store no longer reads the field at all (template-drop-older-store-box-20261101),
 * so the field goes whatever it still says. A store without the field is not changed.
 */
export async function removeStorefrontCommerceBox(db: unknown): Promise<void> {
  const registry = new SchemaRegistry(db as never);
  if (!(await registry.getCollection("products")) || !(await registry.getField("products", COMMERCE_PRODUCT_FIELD))) return;
  await registry.deleteField("products", COMMERCE_PRODUCT_FIELD);
}
