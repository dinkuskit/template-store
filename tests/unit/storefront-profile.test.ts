import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STOREFRONT_PROFILE_PROOF,
  STOREFRONT_PROFILE_SHIPPING,
  isProofMutationEnabled,
  isProofStorefrontProfile,
  loadStorefrontRouteContext,
  readProofDemonstrations,
  readStorefrontProfile,
} from "../../src/features/store-shell/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const merchEntries = [
  {
    id: "everyday-tee",
    data: {
      title: "Everyday Tee",
      category: "Tees",
      commerce_item_id: "dinkus-template-managed-product",
      description: "Soft tee",
      visual_label: "TEE",
    },
  },
  {
    id: "canvas-cap",
    data: {
      title: "Canvas Cap",
      category: "Hats",
      commerce_item_id: "dinkus-template-unmanaged-product",
      description: "Simple cap",
      visual_label: "CAP",
    },
  },
  {
    id: "boxy-tee-preview",
    data: {
      title: "Boxy Tee",
      category: "Tees",
      commerce_item_id: "preview",
      description: "Preview",
      visual_label: "TEE",
    },
  },
] as const;

describe("storefront profile", () => {
  it("defaults to shipping and treats only explicit proof or development as demonstrations", () => {
    expect(readStorefrontProfile({})).toBe(STOREFRONT_PROFILE_SHIPPING);
    expect(readStorefrontProfile({ DINKUS_STOREFRONT_PROFILE: "shipping" })).toBe(
      STOREFRONT_PROFILE_SHIPPING,
    );
    expect(readStorefrontProfile({ DINKUS_PROOF_MODE: "1" })).toBe(
      STOREFRONT_PROFILE_SHIPPING,
    );
    expect(readStorefrontProfile({ DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(
      STOREFRONT_PROFILE_PROOF,
    );
    expect(
      readStorefrontProfile({ DINKUS_STOREFRONT_PROFILE: "development" }),
    ).toBe(STOREFRONT_PROFILE_PROOF);
    expect(isProofStorefrontProfile({})).toBe(false);
    expect(isProofStorefrontProfile({ DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(
      true,
    );
    expect(
      isProofMutationEnabled({
        DINKUS_PROOF_MODE: "1",
        DINKUS_STOREFRONT_PROFILE: "shipping",
      }),
    ).toBe(false);
    expect(
      isProofMutationEnabled({
        DINKUS_PROOF_MODE: "1",
        DINKUS_STOREFRONT_PROFILE: "proof",
      }),
    ).toBe(true);
  });

  it("does not load managed or unmanaged demonstration runtimes in shipping", async () => {
    const context = await loadStorefrontRouteContext(merchEntries, {
      DINKUS_STOREFRONT_PROFILE: "shipping",
    });
    expect(context.profile).toBe(STOREFRONT_PROFILE_SHIPPING);
    expect(context.demonstrations).toBeNull();
    expect(await readProofDemonstrations({ DINKUS_STOREFRONT_PROFILE: "shipping" })).toBeNull();
    expect(context.collections.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "boxy-tee-preview",
    ]);
  });

  it("loads demonstration runtimes only when the proof profile is explicit", async () => {
    const context = await loadStorefrontRouteContext(merchEntries, {
      DINKUS_STOREFRONT_PROFILE: "proof",
    });
    expect(context.profile).toBe(STOREFRONT_PROFILE_PROOF);
    expect(context.demonstrations?.managed.inventory).toMatchObject({
      available: "8",
      inventorySkuId: "dinkus-inventory-sku-demo",
    });
    expect(context.demonstrations?.unmanaged.storefront.status).toBe("in-stock");
    expect(context.collections.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "canvas-cap",
      "everyday-tee",
      "boxy-tee-preview",
    ]);
  });

  it("keeps the fresh seed Home opener on truthful Commerce shop copy and #commerce-catalog", () => {
    const seed = JSON.parse(
      readFileSync(resolve("seed/seed.json"), "utf8"),
    ) as {
      sections: Array<{ content: Array<Record<string, unknown>> }>;
      content: {
        pages: Array<{
          id: string;
          data: {
            content: Array<Record<string, unknown>>;
            layout: Array<Record<string, unknown>>;
          };
        }>;
      };
    };
    const serialized = JSON.stringify(seed);
    expect(serialized).not.toMatch(/two connected styles/iu);
    expect(serialized).not.toMatch(/Inventory \+ manual/u);
    expect(serialized).not.toMatch(/#catalog-title|#managed-product/u);
    const home = seed.content.pages.find((page) => page.id === "home");
    const hero = home?.data.content.find((block) => block._type === "dinkus.page-hero");
    const opener = home?.data.layout[0];
    const sectionHero = seed.sections[0]?.content.find(
      (block) => block._type === "dinkus.page-hero",
    );
    expect(hero).toMatchObject({
      primaryHref: "#commerce-catalog",
      secondaryHref: "#commerce-catalog",
    });
    expect(opener).toMatchObject({
      primary_href: "#commerce-catalog",
      secondary_href: "#commerce-catalog",
    });
    expect(sectionHero).toMatchObject({
      primary_href: "#commerce-catalog",
      secondary_href: "#commerce-catalog",
    });
  });
});
