import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(),
  handleMediaGet: vi.fn(async () => ({ success: false })),
  PluginStorageRepository: class PluginStorageRepository {},
}));
vi.mock("emdash/runtime", () => ({ getDb: vi.fn() }));

import { readCommerceCatalogSnapshots } from "../../src/features/commerce-catalog/index.js";
import { addGuestCartLine, emptyGuestCartIntent, presentGuestCart, projectGuestCartCatalogSnapshots } from "../../src/features/guest-cart/index.js";

// A product sold in a Format choice: the first (default) member is the product itself (its id is the product's id)
// and a digital download; then a printed copy, a member Commerce sends with a fulfillment the store does not know,
// and another digital version (template-store#181 review).
const member = (catalogItemId: string, label: string, minor: string, fulfillment?: unknown) => ({
  catalogItemId, selections: [{ optionId: "format", optionLabel: "Format", valueId: label.toLowerCase(), valueLabel: label }],
  price: { currency: "USD", minor }, availability: { status: "in-stock", sellable: true, listable: true },
  ...(fulfillment === undefined ? {} : { fulfillment }),
});
const guide = {
  id: "guide", name: "Grow guide", sku: "GUIDE",
  availability: { status: "in-stock", sellable: false, listable: true },
  variants: { schema: "dinkuskit.commerce.product-variants/v1", productId: "guide", options: [], members: [
    member("guide", "PDF", "900", "digital"),
    member("guide-print", "Print", "2400", "physical"),
    member("guide-audio", "Audio", "1200", "streamed"),
    member("guide-ebook", "eBook", "700", "digital"),
  ] },
};
const simple = (id: string) => ({ id, name: `Item ${id}`, sku: id.toUpperCase(), price: { currency: "USD", minor: "500" },
  availability: { status: "in-stock", sellable: true, listable: true } });

function context() {
  const fillers = Array.from({ length: 6 }, (_, index) => simple(`filler-${index}`));
  return {
    request: new Request("https://shop.example.test/api/guest-cart/snapshot"),
    runtime: {
      getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }),
      handlePublicPluginApiRoute: vi.fn(async (_plugin: string, _method: string, route: string, request: Request) => {
        if (route === "catalog/public") return { success: true, data: { products: [guide, ...fillers] } };
        const id = new URL(request.url).searchParams.get("itemId") ?? "";
        // Commerce answers a member's id with its whole product.
        return { success: true, data: id === "guide" || id.startsWith("guide-") ? guide : fillers.find(filler => filler.id === id) ?? null };
      }),
    },
  };
}

describe("a cart line for a chosen member keeps that member's fulfillment", () => {
  beforeEach(() => { delete process.env.DINKUS_CATALOG_PROFILE; });

  // Eight lines read item by item; nine read the whole catalog. Both must agree.
  for (const extra of [4, 5]) {
    const ids = ["guide", "guide-print", "guide-audio", "guide-ebook", ...Array.from({ length: extra }, (_, index) => `filler-${index}`)];
    it(`with ${ids.length} lines (${ids.length <= 8 ? "item lookups" : "whole catalog"})`, async () => {
      const ctx = context();
      const snapshots = await readCommerceCatalogSnapshots(ids, ctx);
      const routes = new Set((ctx.runtime.handlePublicPluginApiRoute.mock.calls as unknown as [string, string, string][]).map(([, , route]) => route));
      expect([...routes]).toEqual([ids.length <= 8 ? "catalog/public/item" : "catalog/public"]);
      const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
      // The default member, sharing the product id, is digital; the next is physical; an unknown value fails closed to physical.
      expect(byId.get("guide")).toMatchObject({ found: true, name: "Grow guide — PDF", fulfillment: "digital", price: { unitMinor: "900" } });
      expect(byId.get("guide-print")).toMatchObject({ found: true, name: "Grow guide — Print", fulfillment: "physical", price: { unitMinor: "2400" } });
      expect(byId.get("guide-audio")).toMatchObject({ found: true, fulfillment: "physical" });
      expect(byId.get("guide-ebook")).toMatchObject({ found: true, name: "Grow guide \u2014 eBook", fulfillment: "digital", price: { unitMinor: "700" } });

      // A cart holding only the digital member asks for no delivery address; adding the print copy does.
      const projected = projectGuestCartCatalogSnapshots(JSON.parse(JSON.stringify(snapshots)))!;
      const digitalOnly = addGuestCartLine(emptyGuestCartIntent(), "guide", 1).intent;
      expect(presentGuestCart({ intent: digitalOnly, snapshots: projected }).needsDelivery).toBe(false);
      const withPrint = addGuestCartLine(digitalOnly, "guide-print", 1).intent;
      expect(presentGuestCart({ intent: withPrint, snapshots: projected }).needsDelivery).toBe(true);
    });
  }
});
