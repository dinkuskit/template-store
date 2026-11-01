import { handleMediaGet, PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import {
  CATALOG_COLLECTION,
  COMMERCE_PLUGIN_ID,
  PRODUCT_FEED_ELIGIBILITY_COLLECTION,
  type CatalogStorageRecord,
} from "@dinkuskit/commerce";
import {
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
  loadProductFeedEligibility,
  type ProductFeedChannel,
  type ProductFeedEligibilityRecord,
  type ProductFeedFacts,
} from "@dinkuskit/commerce/features/feeds";
import {
  readInstalledCommerceCatalog,
  type InstalledCatalogContext,
} from "../commerce-catalog/installed.js";
import type { PublicCommerceProduct } from "../commerce-catalog/index.js";
import { resolveCommerceImage } from "../commerce-catalog/media.js";
import { canonicalProductPath, commercePageLinks, readProductEntries } from "../store-shell/product-routes.js";
import { canonicalUrl } from "../store-shell/structured-data.js";

export interface CommerceFeedContext extends InstalledCatalogContext {
  /** Same `Astro.site` value the product page uses for its canonical link. */
  site?: URL | null;
}

async function publishedLinks(links: ReadonlyMap<string, string>) {
  const productsCollection = await import("emdash").then(({ getEmDashCollection }) =>
    getEmDashCollection<"products", Record<string, unknown>>("products", { status: "published" }));
  const categories = await import("emdash").then(({ getEmDashCollection }) =>
    getEmDashCollection<"categories", Record<string, unknown>>("categories", { status: "published" }));
  return readProductEntries(productsCollection.entries, categories.entries, links).products;
}

/**
 * Native installs do not receive channel eligibility on `catalog/public`.
 * The public feeds export reads the same eligibility record the authenticated
 * `catalog-items/set-feed-eligibility` route writes. Shipping/registry stays
 * on the public projection and does not open this collection.
 */
async function nativeFeedEligibility(itemId: string): Promise<readonly ProductFeedChannel[]> {
  const db = await getDb();
  const storage = new PluginStorageRepository<ProductFeedEligibilityRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    PRODUCT_FEED_ELIGIBILITY_COLLECTION,
    [],
  );
  const catalog = new PluginStorageRepository<CatalogStorageRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, []);
  return loadProductFeedEligibility(storage, itemId, catalog);
}

function catalogProduct(product: PublicCommerceProduct): ProductFeedFacts["product"] {
  const variants = product.variants?.length
    ? {
        schema: "dinkuskit.commerce.product-variants/v1" as const,
        productId: product.id,
        options: [],
        members: product.variants.map((member) => ({
          catalogItemId: member.id,
          selections: member.selections.map(([optionLabel, valueLabel], index) => ({
            optionId: optionLabel.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `opt-${index}`,
            optionLabel,
            valueId: valueLabel.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `val-${index}`,
            valueLabel,
          })),
          price: { currency: "USD" as const, minor: member.unitMinor },
          availability: {
            status: member.availability.status,
            sellable: member.availability.sellable,
            listable: true,
          },
          fulfillment: member.fulfillment ?? "physical",
        })),
      }
    : undefined;
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    availability: {
      status: product.availability.status,
      sellable: product.availability.sellable,
      listable: product.availability.listable,
    },
    image: product.image,
    gallery: [...product.gallery],
    ...(product.price.unitMinor
      ? { price: { currency: "USD" as const, minor: product.price.unitMinor } }
      : {}),
    ...(variants ? { variants } : {}),
    ...(product.gtin ? { gtin: product.gtin } : {}),
    ...(product.mpn ? { mpn: product.mpn } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
  };
}

async function publicImageUrls(product: PublicCommerceProduct, context: CommerceFeedContext): Promise<string[]> {
  const origin = context.site?.origin ?? new URL(context.request.url).origin;
  const runtime = context.runtime as { getPublicMediaUrl?: (storageKey: string) => string } | null | undefined;
  const resolved = await Promise.all([product.image, ...product.gallery].map((image) => resolveCommerceImage(image, {
    origin,
    getPublicMediaUrl: runtime?.getPublicMediaUrl,
    async getMedia(id) {
      const result = await handleMediaGet(await getDb(), id);
      const item = result.success ? result.data?.item : null;
      if (!item?.storageKey || !item.mimeType) return null;
      return { mimeType: item.mimeType, storageKey: item.storageKey, status: item.status };
    },
  })));
  return [...new Set(resolved.flatMap((image) => image ? [new URL(image.src, origin).href] : []))];
}

export async function buildInstalledCommerceFeedFacts(
  context: CommerceFeedContext,
): Promise<ProductFeedFacts[]> {
  const products = await readInstalledCommerceCatalog(context);
  // Commerce keeps which page sells each product (template-no-commerce-box-20261029).
  const links = await publishedLinks(commercePageLinks(products));
  const byCommerceId = new Map(links.map((entry) => [entry.commerceItemId, entry]));
  const nativeEligibility = process.env.DINKUS_CATALOG_PROFILE === "native-development";
  const facts: ProductFeedFacts[] = [];
  for (const product of products) {
    const entry = byCommerceId.get(product.id);
    // A catalog item with no published CMS page has no canonical storefront URL.
    if (!entry) continue;
    const eligibility = product.feedChannels !== undefined
      ? product.feedChannels
      : nativeEligibility
        ? await nativeFeedEligibility(product.id)
        : [];
    const imageUrls = await publicImageUrls(product, context);
    facts.push({
      product: catalogProduct(product),
      content: {
        canonicalUrl: canonicalUrl(canonicalProductPath(entry.slug), context.site, context.request.url),
        title: product.name,
        ...(entry.description ? { description: entry.description } : {}),
        ...(imageUrls.length ? { imageUrls } : {}),
      },
      eligibility,
    });
  }
  return facts;
}

export { buildGoogleMerchantFeed, buildMetaCatalogFeed };
export {
  buildAgentCatalogFeed,
  buildInstalledStorefrontAgentFeedOptions,
  buildStorefrontAgentsMd,
  buildStorefrontLlmsFullTxt,
  buildStorefrontLlmsTxt,
  type AgentCatalogFeed,
  type AgentCatalogProductEntry,
  type AgentProductFeedFacts,
  type ProductAiProjection,
  type StorefrontAgentFeedOptions,
  type StorefrontPolicySummary,
  type StorefrontShippingQuoteInput,
} from "./agent-feeds.js";
