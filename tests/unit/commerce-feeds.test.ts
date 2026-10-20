import { beforeEach, describe, expect, it, vi } from "vitest";

const { eligibility } = vi.hoisted(() => ({ eligibility: new Map<string, unknown>() }));

vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(),
  PluginStorageRepository: class PluginStorageRepository {
    async get(id: string) {
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

  it("joins native eligibility when the public catalog omits feed channels", async () => {
    process.env.DINKUS_CATALOG_PROFILE = "native-development";
    eligibility.set("commerce-hat", {
      recordKind: "product-feed-eligibility",
      channels: ["google-merchant"],
    });
    const facts = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat"),
      catalogItem("commerce-cap"),
    ]));
    expect(facts.map((fact) => [fact.product.id, fact.eligibility])).toEqual([
      ["commerce-hat", ["google-merchant"]],
      ["commerce-cap", []],
    ]);
    expect(buildGoogleMerchantFeed(facts)).toContain("<g:id>commerce-hat</g:id>");
    expect(buildGoogleMerchantFeed(facts)).not.toContain("commerce-cap");
  });
});
