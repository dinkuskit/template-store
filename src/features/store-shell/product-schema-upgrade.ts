import { BlockTypeRegistry, SchemaRegistry, type ApplySeedBlockTypeInput, type CreateFieldInput } from "emdash";
import { sql, type Kysely } from "kysely";
import { commerceProfile } from "../commerce-profile/profiles.mjs";

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

// Commerce's storage, as the store's own database keeps it: the native install and either Registry install.
const REGISTRY_COMMERCE_IDS = [commerceProfile("stable").runtimeId, commerceProfile("beta").runtimeId];
const COMMERCE_PLUGIN_IDS = ["dinkus-commerce", ...REGISTRY_COMMERCE_IDS];
const COMMERCE_CATALOG_COLLECTIONS = ["catalogItems", "catalog_items"];

/**
 * The first Commerce that holds which page sells each product (catalog-page-link-in-commerce-20261029). An older
 * one links a page only through the page's Commerce product field.
 */
export const LINK_HOLDING_COMMERCE = "0.7.0-beta.3";

function semver(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  return match ? { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") ?? [] } : null;
}

/** Whether `version` comes before `floor` by semver order; a version that is not semver counts as older. */
export function olderVersion(version: string, floor: string): boolean {
  const a = semver(version), b = semver(floor);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]!;
  // A release comes after its prereleases.
  if (!a.pre.length || !b.pre.length) return a.pre.length > b.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i += 1) {
    const x = a.pre[i]!, y = b.pre[i]!;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y);
    return nx !== ny ? nx : x < y;
  }
  return a.pre.length < b.pre.length;
}

/**
 * The store's Registry installs of Commerce older than LINK_HOLDING_COMMERCE, as `id@version`. A Commerce the
 * store's own config installs (native, or a proof's built bundle) is the one the template pins.
 */
export async function commerceNeedingTheBox(db: unknown): Promise<string[]> {
  const rows = await sql<{ plugin_id: string; version: string }>`
    select plugin_id, version from _plugin_state
    where plugin_id in (${sql.join(REGISTRY_COMMERCE_IDS.map((id) => sql`${id}`))})
      and source in ('registry', 'marketplace')
    order by plugin_id`.execute(db as Kysely<never>);
  return rows.rows.filter((row) => olderVersion(row.version, LINK_HOLDING_COMMERCE)).map((row) => `${row.plugin_id}@${row.version}`);
}

/**
 * The live product pages whose Commerce product field names a real Commerce
 * product that Commerce does not link to the page: neither the panel's pick
 * (`e:`) nor a publish check's sale (`p:`) in Commerce's `product_pages`. A
 * value naming no Commerce product (a typed "123", the seed's demonstration
 * ids) sells nothing, so it does not count.
 */
export async function pagesWithoutCommerceLink(db: unknown): Promise<{ id: string; slug: string | null; itemId: string }[]> {
  const kyselyDb = db as Kysely<never>;
  const plugins = sql.join(COMMERCE_PLUGIN_IDS.map((id) => sql`${id}`));
  const rows = await sql<{ id: string; slug: string | null; itemId: string }>`
    select page.id, page.slug, trim(page.commerce_item_id) as "itemId"
    from ec_products page
    where page.deleted_at is null
      and (page.status = 'published' or page.scheduled_at is not null)
      and trim(coalesce(page.commerce_item_id, '')) != ''
      and exists (
        select 1 from _plugin_storage item
        where item.plugin_id in (${plugins})
          and item.collection in (${sql.join(COMMERCE_CATALOG_COLLECTIONS.map((name) => sql`${name}`))})
          and item.id = trim(page.commerce_item_id)
      )
      and not exists (
        select 1 from _plugin_storage link
        where link.plugin_id in (${plugins})
          and link.collection = 'product_pages'
          and link.id in ('e:' || page.id, 'p:' || page.id)
      )
    order by page.id`.execute(kyselyDb);
  return rows.rows;
}

/**
 * Takes the Commerce product box off an older store's product pages
 * (template-no-commerce-box-20261029). Commerce holds which page sells which
 * product, so the field is removed, but only once no live page needs it:
 * while a published or scheduled page's field names a Commerce product that
 * Commerce does not link to it, the field stays, those pages are logged, and
 * the step answers "wait" to be tried again later. Publishing such a page, or
 * picking its product in its Dinkus Commerce panel, records the link. It also
 * waits while the store runs a Registry Commerce older than the one that holds
 * links, which still links a page only through the field. A store without the
 * field is not changed.
 */
export async function removeStorefrontCommerceBox(db: unknown): Promise<"wait" | void> {
  const registry = new SchemaRegistry(db as never);
  if (!(await registry.getCollection("products")) || !(await registry.getField("products", COMMERCE_PRODUCT_FIELD))) return;
  const older = await commerceNeedingTheBox(db);
  if (older.length > 0) {
    console.warn(`[storefront-upgrade] the Commerce product box stays until Commerce is updated to ${LINK_HOLDING_COMMERCE} or newer: ${older.join(", ")}`);
    return "wait";
  }
  const waiting = await pagesWithoutCommerceLink(db);
  if (waiting.length > 0) {
    console.warn(`[storefront-upgrade] the Commerce product box stays until Commerce links these pages to their products (publish each again, or pick its product in its Dinkus Commerce panel): ${waiting.map((page) => page.slug ?? page.id).join(", ")}`);
    return "wait";
  }
  await registry.deleteField("products", COMMERCE_PRODUCT_FIELD);
}
