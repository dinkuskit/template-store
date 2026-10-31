import { beforeEach, describe, expect, it, vi } from "vitest";

const { eligibility, media } = vi.hoisted(() => ({ eligibility: new Map<string, unknown>(), media: new Map<string, unknown>() }));

vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(),
  handleMediaGet: vi.fn(async (_db: unknown, id: string) => media.has(id)
    ? { success: true, data: { item: media.get(id) } }
    : { success: false }),
  // Commerce 0.7.0 reads a product's feed channels from its catalog record first; these products have none saved there.
  PluginStorageRepository: class PluginStorageRepository {
    constructor(_db: unknown, _plugin: string, private readonly collection: string) {}
    async get(id: string) {
      if (this.collection !== "productFeedEligibility") {
        return id.startsWith("commerce-") ? { recordKind: "catalog-item", itemId: id } : null;
      }
      return eligibility.get(id) ?? null;
    }
  },
}));
vi.mock("emdash/runtime", () => ({
  getDb: vi.fn(),
}));

import { getEmDashCollection } from "emdash";
import {
  buildGoogleMerchantFeed,
  buildInstalledCommerceFeedFacts,
  buildMetaCatalogFeed,
} from "../../src/features/commerce-feeds/index.js";

const getCollection = vi.mocked(getEmDashCollection);

const categories = [{ id: "tees", data: { title: "Tees", description: "Layers" } }];
const products = [
  {
    id: "hat",
    data: {
      title: "Hat",
      description: "A <hat> for the shop",
      visual_label: "CAP",
      commerce_item_id: "commerce-hat",
      categories: ["tees"],
    },
  },
  {
    id: "cap",
    data: {
      title: "Cap",
      description: "A cap",
      visual_label: "CAP",
      commerce_item_id: "commerce-cap",
      categories: ["tees"],
    },
  },
  {
    id: "mug",
    data: {
      title: "Mug",
      description: "A mug",
      visual_label: "TEE",
      commerce_item_id: "commerce-mug",
      categories: ["tees"],
    },
  },
];

function catalogItem(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    sku: id.toUpperCase(),
    price: { currency: "USD", minor: "1250" },
    availability: { status: "in-stock", sellable: true, listable: true },
    ...extra,
  };
}

function context(items: unknown[]) {
  return {
    request: new Request("http://internal.invalid/feeds/google-merchant.xml"),
    site: new URL("https://shop.example.test"),
    runtime: {
      getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }),
      handlePublicPluginApiRoute: vi.fn(async () => ({ success: true, data: { products: items } })),
    },
  };
}

describe("installed Commerce feed facts", () => {
  beforeEach(() => {
    delete process.env.DINKUS_CATALOG_PROFILE;
    eligibility.clear();
    media.clear();
    getCollection.mockImplementation(async (name: string) => {
      if (name === "products") return { entries: products } as never;
      if (name === "categories") return { entries: categories } as never;
      throw new Error(`unexpected collection ${name}`);
    });
  });

  it("joins only published pages, keeps projected channels, and uses the page canonical origin", async () => {
    const facts = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat", { gtin: "4006381333931", feedChannels: ["google-merchant"] }),
      catalogItem("commerce-cap", { feedChannels: ["meta-catalog"] }),
      catalogItem("commerce-mug"),
      catalogItem("commerce-orphan", { feedChannels: ["google-merchant", "meta-catalog"] }),
    ]));
    expect(facts.map((fact) => fact.product.id)).toEqual(["commerce-hat", "commerce-cap", "commerce-mug"]);
    expect(facts[0]).toMatchObject({
      eligibility: ["google-merchant"],
      content: {
        canonicalUrl: "https://shop.example.test/products/hat",
        title: "commerce-hat",
        description: "A <hat> for the shop",
      },
      product: { gtin: "4006381333931" },
    });
    expect(facts[1]!.eligibility).toEqual(["meta-catalog"]);
    expect(facts[2]!.eligibility).toEqual([]);
    expect(JSON.stringify(facts)).not.toContain("internal.invalid");
    expect(JSON.stringify(facts)).not.toContain("commerce-orphan");

    const google = buildGoogleMerchantFeed(facts);
    const meta = buildMetaCatalogFeed(facts);
    expect(google).toContain("<g:id>commerce-hat</g:id>");
    expect(google).toContain("<g:link>https://shop.example.test/products/hat</g:link>");
    expect(google).toContain("<g:gtin>4006381333931</g:gtin>");
    expect(google).toContain("&lt;hat&gt;");
    expect(google).not.toContain("commerce-cap");
    expect(google).not.toContain("commerce-mug");
    expect(google).not.toContain("commerce-orphan");
    expect(meta).toContain("commerce-cap");
    expect(meta).not.toContain("commerce-hat");
    expect(meta).not.toContain("commerce-orphan");
  });

  it("puts a product the public catalog lists without feed channels in no feed", async () => {
    // Commerce's public catalog carries each product's approved channels; the store never reads its storage
    // for them (template-one-build-registry-20261031), so a stored eligibility the catalog omits counts for nothing.
    eligibility.set("commerce-hat", {
      recordKind: "product-feed-eligibility",
      channels: ["google-merchant"],
    });
    const facts = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat"),
      catalogItem("commerce-cap"),
    ]));
    expect(facts.map((fact) => [fact.product.id, fact.eligibility])).toEqual([
      ["commerce-hat", []],
      ["commerce-cap", []],
    ]);
    expect(buildGoogleMerchantFeed(facts)).not.toContain("commerce-hat");
  });

  it("resolves approved primary and gallery images into absolute XML and CSV feed URLs", async () => {
    const image = (id: string) => ({ id, alt: id, width: 640, height: 480, placeholder: false, url: "https://unapproved.example.test/payload.jpg" });
    media.set("main", { mimeType: "image/jpeg", storageKey: "main.jpg", status: "ready" });
    media.set("gallery", { mimeType: "image/png", storageKey: "gallery.png", status: "ready" });
    media.set("document", { mimeType: "application/pdf", storageKey: "document.pdf", status: "ready" });
    media.set("unsafe", { mimeType: "image/png", storageKey: "../unsafe.png", status: "ready" });
    const facts = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat", {
        feedChannels: ["google-merchant", "meta-catalog"], image: image("main"),
        gallery: [image("gallery"), image("main"), image("document"), image("unsafe")],
      }),
    ]));
    const primary = "https://shop.example.test/_emdash/api/media/file/main.jpg";
    const gallery = "https://shop.example.test/_emdash/api/media/file/gallery.png";
    expect(facts[0]!.content.imageUrls).toEqual([primary, gallery]);
    const google = buildGoogleMerchantFeed(facts);
    expect(google).toContain(`<g:image_link>${primary}</g:image_link>`);
    expect(google).toContain(`<g:additional_image_link>${gallery}</g:additional_image_link>`);
    expect(buildMetaCatalogFeed(facts)).toContain(`"${primary}","${gallery}"`);
    expect(google).not.toContain("unapproved");
    expect(google).not.toContain("document.pdf");
    expect(google).not.toContain("internal.invalid");
  });

  it("uses the runtime-approved public media URL and omits unsafe resolver output", async () => {
    media.set("main", { mimeType: "image/jpeg", storageKey: "main.jpg", status: "ready" });
    const ctx = context([catalogItem("commerce-hat", {
      feedChannels: ["google-merchant"],
      image: { id: "main", alt: "Hat", width: null, height: null, placeholder: false },
    })]);
    const approved = { ...ctx, runtime: { ...ctx.runtime, getPublicMediaUrl: (key: string) => `https://media.example.test/${key}` } };
    expect((await buildInstalledCommerceFeedFacts(approved))[0]!.content.imageUrls)
      .toEqual(["https://media.example.test/main.jpg"]);
    const unsafe = { ...ctx, runtime: { ...ctx.runtime, getPublicMediaUrl: () => "javascript:alert(1)" } };
    expect((await buildInstalledCommerceFeedFacts(unsafe))[0]!.content.imageUrls).toBeUndefined();
  });
});
