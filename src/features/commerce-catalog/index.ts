import { handleMediaGet } from "emdash";
import { getDb } from "emdash/runtime";
import type { GuestCartPublicThumbnail } from "../guest-cart/present.js";
import type { PublicPriceView } from "../store-shell/index.js";
import { cartLineProduct, readInstalledCommerceCatalog, readInstalledCommerceProducts, type InstalledCatalogContext } from "./installed.js";
import { resolveCommerceImage, type PublicCommerceImage } from "./media.js";
import type { PublicCommerceProduct } from "./types.js";

export type { PublicCommerceImage } from "./media.js";
export {
  PUBLIC_FEED_CHANNELS,
  type PublicCommerceProduct,
  type PublicCommerceVariant,
  type PublicFeedChannel,
} from "./types.js";

export const availabilityLabels: Record<string, string> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "available-on-backorder": "Available on backorder",
  "low-stock": "Low stock",
  "availability-unavailable": "Availability unavailable",
};

export type CommerceCatalogSnapshot =
  | Readonly<{ id: string; found: false }>
  | Readonly<{
      id: string;
      found: true;
      name: string;
      sku: string;
      fulfillment: "physical" | "digital";
      thumbnail?: GuestCartPublicThumbnail | null;
      price: PublicPriceView;
      availability: Readonly<{ status: string; sellable: boolean; listable: boolean }>;
    }>;

export async function readCommerceCatalog(context?: InstalledCatalogContext): Promise<PublicCommerceProduct[]> {
  // Every store, the playground included, reads the installed Commerce's public catalog
  // (template-one-build-registry-20261031).
  if (!context) throw new Error("Installed catalog context unavailable");
  return readInstalledCommerceCatalog(context);
}

/** Carts up to this many lines look items up one by one; larger carts read the catalog. */
const SNAPSHOT_ITEM_LOOKUP_LIMIT = 8;

/**
 * Resolve a cart thumbnail through the same media contract as ProductMedia.
 * No resolvable Commerce image means no thumbnail; the cart shows a neutral
 * placeholder rather than artwork guessed from the product's name or SKU.
 */
async function resolveSnapshotThumbnail(
  image: PublicCommerceImage | null,
  listable: boolean,
  context?: InstalledCatalogContext,
): Promise<GuestCartPublicThumbnail | null> {
  if (!listable || !image || !context) return null;
  const resolved = await resolveCommerceImage(image, {
    origin: new URL(context.request.url).origin,
    getPublicMediaUrl: (
      context.runtime as { getPublicMediaUrl?: (storageKey: string) => string } | null | undefined
    )?.getPublicMediaUrl,
    async getMedia(mediaId) {
      try {
        const result = await handleMediaGet(await getDb(), mediaId);
        const item = result.success ? result.data?.item : null;
        if (!item?.storageKey || !item.mimeType) return null;
        return { mimeType: item.mimeType, storageKey: item.storageKey, status: item.status };
      } catch {
        return null;
      }
    },
  });
  return resolved ? { src: resolved.src, alt: resolved.alt } : null;
}

export async function readCommerceCatalogSnapshots(
  ids: readonly string[],
  context?: InstalledCatalogContext,
): Promise<CommerceCatalogSnapshot[]> {
  if (!context) throw new Error("Installed catalog context unavailable");
  // A small cart reads just its own items; the whole catalog is several
  // sandboxed pages with an image read per product, slow enough on a real
  // store to run past the cart's time limit.
  const byId = ids.length <= SNAPSHOT_ITEM_LOOKUP_LIMIT
    ? await readInstalledCommerceProducts(ids, context)
    : new Map((await readInstalledCommerceCatalog(context)).flatMap(product =>
        (product.variants?.length ? product.variants.map(member => member.id) : [product.id])
          .map(id => [id, cartLineProduct(product, id)] as const)));
  return Promise.all(ids.map(async (id): Promise<CommerceCatalogSnapshot> => {
    const product = byId.get(id);
    if (!product) return { id, found: false as const };
    const listable = product.price.listable || product.availability.listable;
    const publicName = listable ? product.name : id;
    const publicSku = listable ? product.sku : "";
    const thumbnail = await resolveSnapshotThumbnail(product.image, listable, context);
    return {
      ...product,
      name: publicName,
      sku: publicSku,
      fulfillment: product.fulfillment ?? "physical",
      thumbnail,
      found: true as const,
    };
  }));
}
