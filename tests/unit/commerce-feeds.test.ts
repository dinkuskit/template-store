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
  buildAgentCatalogFeed,
  buildGoogleMerchantFeed,
  buildInstalledAgentCatalogFeed,
  buildInstalledCommerceFeedFacts,
  buildInstalledStorefrontAgentFeedOptions,
  buildMetaCatalogFeed,
  buildStorefrontAgentsMd,
  buildStorefrontLlmsFullTxt,
  buildStorefrontLlmsTxt,
} from "../../src/features/commerce-feeds/index.js";
import { REVIEWS_REGISTRY_RUNTIME_ID } from "../../src/features/review-form/index.js";

const getCollection = vi.mocked(getEmDashCollection);

const categories = [{ id: "tees", data: { title: "Tees", description: "Layers" } }];
const products = [
  {
    id: "hat",
    data: {
      title: "Hat",
      description: "A <hat> for the shop",
      visual_label: "CAP",
      id: "01HAT",
      categories: ["tees"],
    },
  },
  {
    id: "cap",
    data: {
      title: "Cap",
      description: "A cap",
      visual_label: "CAP",
      id: "01CAP",
      categories: ["tees"],
    },
  },
  {
    id: "mug",
    data: {
      title: "Mug",
      description: "A mug",
      visual_label: "TEE",
      id: "01MUG",
      categories: ["tees"],
    },
  },
];

// The page Commerce links each product to (template-no-commerce-box-20261029); the orphan has none.
const PAGES: Record<string, string> = { "commerce-hat": "01HAT", "commerce-cap": "01CAP", "commerce-mug": "01MUG" };
function catalogItem(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    ...(PAGES[id] ? { page: PAGES[id] } : {}),
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

  it("enriches only eligible families and preserves Commerce and Reviews authority", async () => {
    const ctx = context([
      catalogItem("commerce-hat"), catalogItem("commerce-cap"), catalogItem("commerce-mug", { name: "" }), catalogItem("commerce-orphan"),
    ]);
    ctx.request = new Request("https://shop.example.test/feeds/agent-catalog.json?cursor=foreign", { headers: { cookie: "shopper=private" } });
    const commerce = ctx.runtime.handlePublicPluginApiRoute;
    const reviewReads: string[] = [];
    const rating = { value: 4.3, scale_min: 1, scale_max: 5, count: 3 };
    const handle = vi.fn(async (plugin: string, method: string, route: string, request: Request) => {
      if (plugin !== REVIEWS_REGISTRY_RUNTIME_ID) return commerce();
      const url = new URL(request.url);
      expect(method).toBe("GET");
      expect(route).toBe("rating");
      expect([...url.searchParams.keys()]).toEqual(["product"]);
      expect(request.headers.has("cookie")).toBe(false);
      const productId = url.searchParams.get("product")!;
      reviewReads.push(productId);
      // A valid published aggregate has no review text/name in the resulting feed even if the plugin sent extra keys.
      const data = productId === "commerce-hat"
        ? { productId, rating: { ...rating, unexpected: "private" }, text: "private" }
        : { productId: "another-product", rating };
      return { success: true, data: { __emdashPluginResponse: true, status: 200, body: { kind: "text", value: JSON.stringify(data) } } };
    });
    const feed = await buildInstalledAgentCatalogFeed({ ...ctx, runtime: { handlePublicPluginApiRoute: handle } });
    expect(reviewReads).toEqual(["commerce-hat", "commerce-cap"]);
    expect(feed.products.map((item) => [item.id, item.rating])).toEqual([["commerce-hat", rating], ["commerce-cap", undefined]]);
    expect(feed.products[0]).toMatchObject({ canonicalUrl: "https://shop.example.test/products/hat", price: { minor: "1250" } });
  });

  it("does not query Reviews on opt-out and stops probing an uninstalled Reviews route after one call", async () => {
    const items = [catalogItem("commerce-hat"), catalogItem("commerce-cap")];
    const ctx = context(items);
    let offCatalog = true;
    const dispatch = vi.fn(async (plugin: string) => plugin === REVIEWS_REGISTRY_RUNTIME_ID
      ? { success: false, error: { code: "NOT_FOUND" } }
      : { success: true, data: { products: items, offCatalog } });
    const run = () => buildInstalledAgentCatalogFeed({ ...ctx, runtime: { handlePublicPluginApiRoute: dispatch } });
    const reviewCalls = () => dispatch.mock.calls.filter(([id]) => id === REVIEWS_REGISTRY_RUNTIME_ID).length;
    expect((await run()).products).toEqual([]);
    expect(reviewCalls()).toBe(0);
    offCatalog = false;
    const { products } = await run();
    expect(reviewCalls()).toBe(1);
    expect(products).toHaveLength(2);
    for (const item of products) expect(item).not.toHaveProperty("rating");
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

  it("provides published member landing URLs without changing the family canonical or Commerce facts", async () => {
    const member = (id: string, label: string, status = "in-stock", sellable = true) => ({
      catalogItemId: id, selections: [{ optionId: "size", optionLabel: "Size", valueId: label, valueLabel: label }],
      price: { currency: "USD", minor: "3400" }, availability: { status, sellable, listable: true }, fulfillment: "physical",
    });
    const items = [catalogItem("commerce-hat", {
      price: undefined, feedChannels: ["google-merchant", "meta-catalog"],
      variants: { schema: "dinkuskit.commerce.product-variants/v1", productId: "commerce-hat", options: [],
        members: [member("hat-m", "M"), member("hat-l", "L", "available-on-backorder"), member("hat-xl", "XL", "out-of-stock", false),
          member("unsafe&member", "Invalid")] },
    }), catalogItem("commerce-orphan", { feedChannels: ["google-merchant"] }), catalogItem("commerce-cap")];
    const original = structuredClone(items);
    const ctx = context(items);
    ctx.request = new Request("http://internal.invalid/feeds/google-merchant.xml?variant=foreign&token=not-forwarded");
    const facts = await buildInstalledCommerceFeedFacts(ctx);
    expect(facts[0]!.content).toMatchObject({
      canonicalUrl: "https://shop.example.test/products/hat",
      variantUrls: {
        "hat-m": "https://shop.example.test/products/hat?variant=hat-m",
        "hat-l": "https://shop.example.test/products/hat?variant=hat-l",
        "hat-xl": "https://shop.example.test/products/hat?variant=hat-xl",
      },
    });
    expect(facts[1]!.content).not.toHaveProperty("variantUrls");
    expect(facts[0]!.product.variants!.members.map(m => [m.catalogItemId, m.price?.minor, m.availability.status])).toEqual([
      ["hat-m", "3400", "in-stock"], ["hat-l", "3400", "available-on-backorder"], ["hat-xl", "3400", "out-of-stock"],
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/internal.invalid|foreign|not-forwarded|unsafe&member|commerce-orphan/);
    expect(items).toEqual(original);
    const requestOriginFacts = await buildInstalledCommerceFeedFacts({ ...ctx, site: null,
      request: new Request("https://request.example.test/feeds/meta-catalog.csv?variant=foreign"),
    });
    expect(requestOriginFacts[0]!.content.canonicalUrl).toBe("https://request.example.test/products/hat");
    expect(requestOriginFacts[0]!.content).toMatchObject({ variantUrls: {
      "hat-xl": "https://request.example.test/products/hat?variant=hat-xl",
    } });
  });

  it("passes Commerce's expected ship dates only for the backordered offers that own them", async () => {
    const stock = (status: string, shipBy?: unknown) => ({ status, shipBy, sellable: true, listable: true });
    const member = (size: string, availability: ReturnType<typeof stock>) => ({
      catalogItemId: `hat-${size}`, selections: [{ optionLabel: "Size", valueLabel: size }],
      price: { currency: "USD", minor: "3400" }, availability,
    });
    const channels = ["google-merchant", "meta-catalog"];
    const [family, simple, old] = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat", {
        price: undefined, feedChannels: channels, variants: { members: [
          member("M", stock("in-stock", "2026-12-01")),
          member("XL", stock("available-on-backorder", "2026-12-13")),
          member("XS", stock("available-on-backorder", ["2026-12-13"])),
        ] },
      }),
      catalogItem("commerce-cap", { availability: stock("available-on-backorder", "2026-12-08"), feedChannels: channels }),
      catalogItem("commerce-mug", { availability: stock("available-on-backorder"), feedChannels: channels }),
    ]));
    expect(simple!.product.availability).toMatchObject({ shipBy: "2026-12-08" });
    expect(old!.product.availability).not.toHaveProperty("shipBy");
    expect(family!.product.variants!.members.map(({ catalogItemId, availability }) => [catalogItemId, availability])).toEqual([
      ["hat-M", { status: "in-stock", listable: true, sellable: true }],
      ["hat-XL", { status: "available-on-backorder", listable: true, sellable: true, shipBy: "2026-12-13" }],
      ["hat-XS", { status: "available-on-backorder", listable: true, sellable: true }],
    ]);
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

  it("builds storefront /llms.txt, /llms-full.txt, and /agents.md from installed catalog facts", async () => {
    const facts = await buildInstalledCommerceFeedFacts(context([
      catalogItem("commerce-hat", { gtin: "4006381333931", feedChannels: ["google-merchant"] }),
      catalogItem("commerce-cap", {
        price: undefined,
        availability: { status: "in-stock", sellable: false, listable: true },
        feedChannels: ["meta-catalog"],
        variants: {
          schema: "dinkuskit.commerce.product-variants/v1",
          productId: "commerce-cap",
          options: [{ optionId: "size", label: "Size", values: [{ valueId: "sm", label: "Small" }, { valueId: "lg", label: "Large" }] }],
          members: [
            {
              catalogItemId: "commerce-cap-sm",
              selections: [{ optionId: "size", optionLabel: "Size", valueId: "sm", valueLabel: "Small" }],
              price: { currency: "USD", minor: "1800" },
              availability: { status: "in-stock", sellable: true, listable: true },
              fulfillment: "physical",
            },
            {
              catalogItemId: "commerce-cap-lg",
              selections: [{ optionId: "size", optionLabel: "Size", valueId: "lg", valueLabel: "Large" }],
              price: { currency: "USD", minor: "2200" },
              availability: { status: "out-of-stock", sellable: false, listable: true },
              fulfillment: "physical",
            },
          ],
        },
      }),
      catalogItem("commerce-mug", { availability: { status: "out-of-stock", sellable: false, listable: true } }),
    ]));
    const options = {
      products: facts,
      storeName: "Dinkus Store",
      siteOrigin: "https://shop.example.test",
      description: "Agent-ready store.",
      checkoutBreakdownSelector: "[data-checkout-breakdown]",
      policies: [
        { slug: "shipping", title: "Shipping policy", url: "https://shop.example.test/shipping", body: "Ships in 2 business days." },
        { slug: "returns", title: "Returns policy", url: "https://shop.example.test/returns", body: "30-day returns." },
      ],
    };
    const agentFeed = buildAgentCatalogFeed(options);
    expect(agentFeed.virtualCardSizing.taxMinor).toBe("0");
    expect(agentFeed.products.map((item) => [item.id, item.availability.sellable])).toEqual([
      ["commerce-hat", true],
      ["commerce-cap", true],
      // No Google or Meta box is ticked on the mug: the agent feed lists it anyway
      // (GrillTrack template-agent-feed-lists-all-20261122).
      ["commerce-mug", false],
    ]);
    expect(agentFeed.products[1]?.variants?.members.map((member) => [member.catalogItemId, member.price.minor])).toEqual([
      ["commerce-cap-sm", "1800"],
      ["commerce-cap-lg", "2200"],
    ]);

    const llmsTxt = buildStorefrontLlmsTxt(options);
    expect(llmsTxt).toContain("# Dinkus Store");
    expect(llmsTxt).toContain("https://shop.example.test/llms-full.txt");
    expect(llmsTxt).toContain("https://shop.example.test/agents.md");
    expect(llmsTxt).toContain("[commerce-hat](https://shop.example.test/products/hat)");
    expect(llmsTxt).toContain("[commerce-cap](https://shop.example.test/products/cap): from $18.00 USD");
    expect(llmsTxt).toContain("[commerce-mug](https://shop.example.test/products/mug)");

    const llmsFullTxt = buildStorefrontLlmsFullTxt(options);
    expect(llmsFullTxt).toContain("## Detailed Product Projections");
    expect(llmsFullTxt).toContain("- GTIN: `4006381333931`");
    expect(llmsFullTxt).toContain("`catalogItemId: \"commerce-cap-sm\"` (Size: Small)");
    expect(llmsFullTxt).toContain("## Store Policies Corpus");

    const agentsMd = buildStorefrontAgentsMd(options);
    expect(agentsMd).toContain("# Shopping Agent & Virtual Card Contract — Dinkus Store");
    expect(agentsMd).toContain("data-checkout-tax-minor=\"0\"");
    expect(agentsMd).toContain("tax: { currency: \"USD\", minor: \"0\" }");
    expect(agentsMd).toContain("/api/guest-cart/snapshot?ids=<id1,id2>");
    expect(agentsMd).not.toContain("/catalog/public");
    expect(agentsMd).toContain("/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/prepare");
    expect(agentsMd).toContain("data.capability.capability");
    expect(agentsMd).toContain("/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/cart");
    expect(agentsMd).toContain("/cart/update.js");
    expect(agentsMd).not.toContain("checkout/guest/status");
    expect(agentsMd).not.toContain("/api/checkout/status");
    expect(agentsMd).toContain("data.checkout.retryAfter === data.checkout.attemptId");
    expect(agentsMd).toContain("recoverable-failure");
    expect(agentsMd).toContain("Pre-Start Checkout DOM Estimate Attributes");
    expect(agentsMd).toContain("exclusively from Commerce's authoritative frozen `data.checkout.pricing.finalTotal.minor`");
  });

  it("links agents to the store's EmDash policy pages and reads no Commerce policy records", async () => {
    // A store's policies are its EmDash pages; Commerce keeps no policy records (GrillTrack policy-pages-content-20261031).
    const items = [catalogItem("commerce-hat", { feedChannels: ["google-merchant"] })];
    const dispatch = vi.fn(async (_pluginId: string, _method: string, path: string) => {
      if (path === "policies/public") throw new Error("Commerce keeps no policy records");
      return { success: true, data: { products: items } };
    });
    const installedOptions = await buildInstalledStorefrontAgentFeedOptions({
      request: new Request("http://internal.invalid/llms-full.txt"),
      site: new URL("https://shop.example.test"),
      runtime: { getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }), handlePublicPluginApiRoute: dispatch },
    });
    expect(dispatch.mock.calls.map((call) => call[2])).not.toContain("policies/public");
    expect(installedOptions.shipping).toBeNull();
    expect(installedOptions.policies).toEqual([
      { slug: "shipping", title: "Shipping policy", url: "https://shop.example.test/shipping" },
      { slug: "returns", title: "Returns policy", url: "https://shop.example.test/returns" },
    ]);
    expect(buildStorefrontLlmsTxt(installedOptions)).toContain("Calculated at checkout");
  });

  it("states a free-over threshold when a shipping quote is given", () => {
    const text = buildStorefrontLlmsTxt({
      storeName: "Shop", siteOrigin: "https://shop.example.test", products: [],
      shipping: { mode: "flat", amount: { currency: "USD", minor: "500" }, freeOver: { currency: "USD", minor: "5000" } },
    });
    expect(text).toContain("free when discounted net merchandise (netMerchandise) is at least $50.00 USD (>= 5000 minor units, inclusive, after coupon discounts)");
  });
});
