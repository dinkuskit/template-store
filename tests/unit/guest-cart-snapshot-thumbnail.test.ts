import { beforeEach, describe, expect, it, vi } from "vitest";

const { media } = vi.hoisted(() => ({ media: new Map<string, unknown>() }));

vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(),
  handleMediaGet: vi.fn(async (_db: unknown, id: string) => media.has(id)
    ? { success: true, data: { item: media.get(id) } }
    : { success: false }),
  PluginStorageRepository: class PluginStorageRepository {},
}));
vi.mock("emdash/runtime", () => ({ getDb: vi.fn() }));

import { readCommerceCatalogSnapshots } from "../../src/features/commerce-catalog/index.js";
import { projectGuestCartCatalogSnapshots } from "../../src/features/guest-cart/index.js";

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Product ${id}`,
    sku: id.toUpperCase(),
    price: { currency: "USD", minor: "1250" },
    availability: { status: "in-stock", sellable: true, listable: true },
    ...extra,
  };
}

function context(items: Record<string, unknown>, getPublicMediaUrl?: (key: string) => string) {
  return {
    request: new Request("https://shop.example.test/api/guest-cart/snapshot"),
    runtime: {
      getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }),
      handlePublicPluginApiRoute: vi.fn(async (_plugin: string, _method: string, _path: string, request: Request) => {
        const id = new URL(request.url).searchParams.get("itemId") ?? "";
        return { success: true, data: items[id] ?? null };
      }),
      ...(getPublicMediaUrl ? { getPublicMediaUrl } : {}),
    },
  };
}

const image = { id: "main", alt: "Olive hoodie", width: 640, height: 480, placeholder: false };

describe("guest cart snapshot thumbnails (resolver to projection)", () => {
  beforeEach(() => {
    delete process.env.DINKUS_CATALOG_PROFILE;
    media.clear();
    media.set("main", { mimeType: "image/jpeg", storageKey: "main.jpg", status: "ready" });
  });

  it("preserves a runtime-approved HTTPS media URL through the browser projection", async () => {
    const ctx = context({ hoodie: item("hoodie", { image }) }, (key) => `https://media.example.test/${key}`);
    const snapshots = await readCommerceCatalogSnapshots(["hoodie"], ctx);
    expect(snapshots[0]).toMatchObject({ thumbnail: { src: "https://media.example.test/main.jpg", alt: "Olive hoodie" } });
    const projected = projectGuestCartCatalogSnapshots(JSON.parse(JSON.stringify(snapshots)));
    expect(projected?.[0]).toMatchObject({ thumbnail: { src: "https://media.example.test/main.jpg", alt: "Olive hoodie" } });
  });

  it("falls back to the default same-origin media file path", async () => {
    const snapshots = await readCommerceCatalogSnapshots(["hoodie"], context({ hoodie: item("hoodie", { image }) }));
    const projected = projectGuestCartCatalogSnapshots(JSON.parse(JSON.stringify(snapshots)));
    expect(projected?.[0]).toMatchObject({ thumbnail: { src: "/_emdash/api/media/file/main.jpg" } });
  });

  it("drops unsafe resolver output and missing media to null, and never exposes unlisted media", async () => {
    const unsafe = context({ hoodie: item("hoodie", { image }) }, () => "javascript:alert(1)");
    expect((await readCommerceCatalogSnapshots(["hoodie"], unsafe))[0]).toMatchObject({ thumbnail: null });
    const noImage = context({ tee: item("tee") });
    expect((await readCommerceCatalogSnapshots(["tee"], noImage))[0]).toMatchObject({ thumbnail: null });
    const unlisted = context({
      hoodie: item("hoodie", {
        image,
        price: { currency: "USD", minor: null },
        availability: { status: "in-stock", sellable: false, listable: false },
      }),
    }, (key) => `https://media.example.test/${key}`);
    // The installed projection only admits listable products; an unlisted one is not found, so no media leaks.
    expect((await readCommerceCatalogSnapshots(["hoodie"], unlisted))[0]).toEqual({ id: "hoodie", found: false });
  });
});
