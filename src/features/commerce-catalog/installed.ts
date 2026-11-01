import { formatUsdMinor } from "../store-shell/price.js";
import {
  PUBLIC_FEED_CHANNELS,
  type PublicCommerceProduct,
  type PublicCommerceVariant,
  type PublicFeedChannel,
} from "./types.js";
import { readCommerceGallery, readCommerceImage } from "./media.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";

const ROUTE = "catalog/public";
const ITEM_ROUTE = "catalog/public/item";
const STATUSES = new Set(["in-stock", "low-stock", "out-of-stock", "available-on-backorder", "availability-unavailable"]);
/** Every store, the playground included, runs Commerce's Registry build (template-one-build-registry-20261031). */
function installedPluginId(): string {
  return COMMERCE_REGISTRY_RUNTIME_ID;
}

export interface InstalledCatalogContext {
  request: Request;
  runtime: {
    getPluginRouteMeta?(pluginId: string, path: string): { public?: boolean; methods?: readonly string[] } | null;
    handlePublicPluginApiRoute(pluginId: string, method: string, path: string, request: Request): Promise<{ success: boolean; data?: unknown }>;
  } | null | undefined;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MINOR = /^(0|[1-9][0-9]*)$/u;

function usdMinor(value: unknown): string | null {
  return object(value) && value.currency === "USD" && typeof value.minor === "string" && MINOR.test(value.minor)
    ? value.minor : null;
}

/**
 * Display price for a variant product that Commerce projects without a
 * top-level price. Uses only server-projected member prices (customerPays);
 * the lowest is shown, prefixed "from" when members differ.
 */
function variantPriceText(variants: unknown): string | null {
  if (!object(variants) || !Array.isArray(variants.members)) return null;
  const minors: bigint[] = [];
  for (const member of variants.members) {
    if (!object(member)) continue;
    const minor = usdMinor(member.price);
    if (minor !== null) minors.push(BigInt(minor));
  }
  if (!minors.length) return null;
  const lowest = minors.reduce((a, b) => (b < a ? b : a));
  const text = formatUsdMinor(lowest.toString());
  return minors.some(minor => minor !== lowest) ? `from ${text}` : text;
}

/** Members with a valid id, USD price, selections, and listable availability. */
function variantMembers(variants: unknown): PublicCommerceVariant[] {
  if (!object(variants) || !Array.isArray(variants.members)) return [];
  const members: PublicCommerceVariant[] = [];
  for (const member of variants.members) {
    if (!object(member) || typeof member.catalogItemId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(member.catalogItemId)) continue;
    const minor = usdMinor(member.price);
    const availability = member.availability;
    if (minor === null || !object(availability) || typeof availability.status !== "string" ||
        !STATUSES.has(availability.status) || availability.listable !== true || typeof availability.sellable !== "boolean") continue;
    if (!Array.isArray(member.selections)) continue;
    const selections = member.selections.flatMap((s): [string, string][] =>
      object(s) && typeof s.optionLabel === "string" && typeof s.valueLabel === "string" ? [[s.optionLabel, s.valueLabel]] : []);
    if (!selections.length) continue;
    members.push({
      id: member.catalogItemId,
      selections,
      unitMinor: minor,
      priceText: formatUsdMinor(minor),
      availability: { status: availability.status as PublicCommerceVariant["availability"]["status"], sellable: availability.sellable },
      ...(member.fulfillment === "physical" || member.fulfillment === "digital" ? { fulfillment: member.fulfillment } : {}),
    });
  }
  return members;
}

/**
 * EmDash's anonymous fast path exposes only handlePublicPluginApiRoute, which
 * itself refuses non-public routes. When route metadata is exposed, also
 * require a public GET route before dispatching.
 */
function publicGetRoute(runtime: NonNullable<InstalledCatalogContext["runtime"]>, pluginId: string, route: string): boolean {
  if (typeof runtime.handlePublicPluginApiRoute !== "function") return false;
  if (typeof runtime.getPluginRouteMeta !== "function") return true;
  const metadata = runtime.getPluginRouteMeta(pluginId, route);
  return metadata?.public === true && metadata.methods?.includes("GET") === true;
}

type ProductResult = { product: PublicCommerceProduct } | { id: string | null; reason: string };

/** Keep an explicit public channel list. A missing field stays missing. */
function feedChannels(value: Record<string, unknown>): PublicFeedChannel[] | "invalid" | undefined {
  if (!Object.hasOwn(value, "feedChannels")) return undefined;
  const raw = value.feedChannels;
  if (!Array.isArray(raw)) return "invalid";
  const channels: PublicFeedChannel[] = [];
  for (const entry of raw) {
    if (!(PUBLIC_FEED_CHANNELS as readonly string[]).includes(entry as string)) return "invalid";
    const channel = entry as PublicFeedChannel;
    if (!channels.includes(channel)) channels.push(channel);
  }
  return channels.sort();
}

function product(value: unknown): ProductResult {
  const id = object(value) && typeof value.id === "string" && /^[a-zA-Z0-9_-]+$/.test(value.id) ? value.id : null;
  const fail = (reason: string): ProductResult => ({ id, reason });
  if (!object(value) || id === null) return fail("invalid id");
  if (typeof value.name !== "string" || typeof value.sku !== "string") return fail("invalid name or sku");
  const channels = feedChannels(value);
  if (channels === "invalid") return fail("invalid feed channels");
  if (!object(value.availability) || typeof value.availability.status !== "string" ||
      !STATUSES.has(value.availability.status) || value.availability.listable !== true ||
      typeof value.availability.sellable !== "boolean") return fail("invalid availability");
  let regularText: string | null;
  let unitMinor: string | null = null;
  if (value.price !== undefined) {
    const minor = usdMinor(value.price);
    unitMinor = minor;
    regularText = minor === null ? null : formatUsdMinor(minor);
    if (regularText === null) return fail("invalid price");
  } else {
    regularText = variantPriceText(value.variants);
    if (regularText === null) return fail("missing price");
  }
  return { product: {
    id, name: value.name, sku: value.sku,
    ...(typeof value.gtin === "string" && value.gtin ? { gtin: value.gtin } : {}),
    ...(typeof value.mpn === "string" && value.mpn ? { mpn: value.mpn } : {}),
    ...(typeof value.brand === "string" && value.brand ? { brand: value.brand } : {}),
    ...(channels !== undefined ? { feedChannels: channels } : {}),
    // Commerce's installed public projection does not expose simple-item
    // fulfillment yet; fail closed to physical so checkout never omits a
    // required delivery address.
    fulfillment: "physical",
    // Commerce projects customerPays only; never reconstruct a regular/sale pair.
    price: { listable: true, regularText, saleText: null, ...(unitMinor ? { unitMinor } : {}) },
    availability: {
      status: value.availability.status as PublicCommerceProduct["availability"]["status"],
      // Commerce reports a variant parent as not sellable; the parent id is
      // never added to the cart, and checkout reprices server-side.
      sellable: value.availability.sellable, listable: true,
    },
    // A bad image degrades to a placeholder. It must not hide the price.
    image: readCommerceImage(value.image, value.name),
    gallery: readCommerceGallery(value.gallery, value.name),
    ...(value.variants !== undefined ? { variants: variantMembers(value.variants) } : {}),
    ...(typeof value.page === "string" && value.page ? { page: value.page } : {}),
  } };
}

/** Public-only SSR dispatch preserves the installed plugin's original context. */
export async function readInstalledCommerceCatalog({ runtime, request }: InstalledCatalogContext): Promise<PublicCommerceProduct[]> {
  const pluginId = installedPluginId();
  if (!runtime || !publicGetRoute(runtime, pluginId, ROUTE)) {
    throw new Error("Installed public catalog unavailable");
  }
  const products: PublicCommerceProduct[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL(`/_emdash/api/plugins/${pluginId}/${ROUTE}`, request.url);
    if (cursor) url.searchParams.set("cursor", cursor);
    // No incoming cookies, credentials, query parameters, or shopper capability.
    const result = await runtime.handlePublicPluginApiRoute(
      pluginId, "GET", ROUTE, new Request(url, { method: "GET" }),
    );
    if (!result.success || !object(result.data) || !Array.isArray(result.data.products) || result.data.products.length > 50) {
      throw new Error("Installed public catalog unavailable");
    }
    for (const value of result.data.products) {
      const parsed = product(value);
      if (!("product" in parsed)) {
        // Skip one bad item; the rest of the catalog still renders. Id and reason only.
        console.warn("Skipping invalid installed catalog item", { id: parsed.id, reason: parsed.reason });
        continue;
      }
      const item = parsed.product;
      if (ids.has(item.id)) throw new Error("Duplicate installed catalog identity");
      ids.add(item.id); products.push(item);
    }
    const next = result.data.cursor;
    if (next !== undefined && (typeof next !== "string" || next.length < 1 || next.length > 1024 || cursors.has(next))) {
      throw new Error("Invalid installed catalog cursor");
    }
    cursor = next as string | undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor !== undefined);
  return products;
}

async function lookupInstalledCommerceProduct(
  itemId: string,
  { runtime, request }: InstalledCatalogContext,
  by: "itemId" | "pageId" = "itemId",
): Promise<ProductResult | null> {
  const pluginId = installedPluginId();
  if (!runtime || !publicGetRoute(runtime, pluginId, ITEM_ROUTE)) {
    throw new Error("Installed public product lookup unavailable");
  }
  const url = new URL(`/_emdash/api/plugins/${pluginId}/${ITEM_ROUTE}`, request.url);
  url.searchParams.set(by, itemId);
  const result = await runtime.handlePublicPluginApiRoute(
    pluginId,
    "GET",
    ITEM_ROUTE,
    new Request(url, { method: "GET" }),
  );
  if (!result.success) {
    throw new Error("Installed public product unavailable");
  }
  if (result.data === null) return null;
  if (!object(result.data)) throw new Error("Invalid installed product projection");
  return product(result.data);
}

export async function readInstalledCommerceProduct(
  itemId: string,
  context: InstalledCatalogContext,
): Promise<PublicCommerceProduct | null> {
  const parsed = await lookupInstalledCommerceProduct(itemId, context);
  if (parsed === null) return null;
  if (!("product" in parsed)) throw new Error("Invalid installed product projection");
  return parsed.product;
}

/**
 * The product a published page sells, found by the page's entry id, which
 * Commerce keeps (template-no-commerce-box-20261029); null when that page
 * sells nothing on the shop. A Commerce that cannot answer throws, and the
 * caller treats the page as unavailable.
 */
export async function readInstalledCommerceProductByPage(
  pageId: string,
  context: InstalledCatalogContext,
): Promise<PublicCommerceProduct | null> {
  const parsed = await lookupInstalledCommerceProduct(pageId, context, "pageId");
  if (parsed === null) return null;
  if (!("product" in parsed) || parsed.product.page !== pageId) throw new Error("Invalid installed product projection");
  return parsed.product;
}

/**
 * The product a cart line's id buys. Commerce answers a variant member's id
 * with its whole product, so a product with choices is read through the
 * chosen member: its own price, availability and fulfillment, never the
 * product's "from" price or another member. A member Commerce no longer lists is null.
 */
export function cartLineProduct(item: PublicCommerceProduct, itemId: string): PublicCommerceProduct | null {
  if (!item.variants?.length) return item.id === itemId ? item : null;
  const member = item.variants.find(variant => variant.id === itemId);
  if (!member) return null;
  const { variants: _variants, ...rest } = item;
  return {
    ...rest,
    id: member.id,
    name: `${item.name} \u2014 ${member.selections.map(([, value]) => value).join(" / ")}`,
    // Commerce projects no member SKU; the product's SKU would name a different item.
    sku: "",
    price: { listable: true, regularText: member.priceText, saleText: null, unitMinor: member.unitMinor },
    availability: { ...member.availability, listable: true },
    // Commerce projects each member's fulfillment, so a digital Size checks out without a delivery address;
    // without one, fail closed to physical as for simple products.
    fulfillment: member.fulfillment ?? "physical",
  };
}

/**
 * Reads only the requested items, one public item lookup each, instead of the
 * whole catalog. An item Commerce no longer lists, or one whose projection is
 * invalid, comes back null; a variant member id comes back as that member.
 */
export async function readInstalledCommerceProducts(
  itemIds: readonly string[],
  context: InstalledCatalogContext,
): Promise<Map<string, PublicCommerceProduct | null>> {
  const found = await Promise.all(itemIds.map(async (itemId): Promise<[string, PublicCommerceProduct | null]> => {
    const parsed = await lookupInstalledCommerceProduct(itemId, context);
    if (parsed !== null && !("product" in parsed)) {
      console.warn("Skipping invalid installed catalog item", { id: parsed.id, reason: parsed.reason });
    }
    return [itemId, parsed !== null && "product" in parsed ? cartLineProduct(parsed.product, itemId) : null];
  }));
  return new Map(found);
}
