import { describe, expect, it, vi } from "vitest";

import { productPageChange, withProductOnSale } from "../../src/features/product-on-sale/index.js";

const user = { id: "u1", email: "owner@example.test", name: null, role: 50, createdAt: "2026-10-23T00:00:00.000Z" };

function runtime(fields: Record<string, unknown> | null, result = { success: true, data: { changed: true } }) {
  const calls: Array<{ pluginId: string; path: string; body: unknown; user: unknown }> = [];
  return {
    calls,
    handleContentGet: vi.fn(async (_collection: string, id: string) =>
      fields ? { success: true, data: { item: { id: "01PAGE", slug: id, data: fields } } } : { success: false, error: { message: "not found" } }),
    handlePluginApiRoute: vi.fn(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      calls.push({ pluginId, path, body: await request.json(), user: caller });
      return result;
    }),
  };
}

function input(method: string, path: string, rt: ReturnType<typeof runtime>, caller: unknown = user) {
  const url = new URL(path, "https://shop.example.test");
  return { request: new Request(url, { method }), url, runtime: rt, user: caller, commercePluginId: "r_commerce" };
}

describe("product page publish check tells Commerce", () => {
  it("recognizes only products-page publish, unpublish and trash requests", () => {
    expect(productPageChange("POST", "/_emdash/api/content/products/01PAGE/publish")).toEqual({ entryId: "01PAGE", action: "publish" });
    expect(productPageChange("POST", "/_emdash/api/content/products/01PAGE/unpublish")).toEqual({ entryId: "01PAGE", action: "unpublish" });
    expect(productPageChange("DELETE", "/_emdash/api/content/products/01PAGE")).toEqual({ entryId: "01PAGE", action: "trash" });
    expect(productPageChange("PUT", "/_emdash/api/content/products/01PAGE")).toBeNull();
    expect(productPageChange("POST", "/_emdash/api/content/pages/01PAGE/publish")).toBeNull();
    expect(productPageChange("POST", "/_emdash/api/content/products/01PAGE/schedule")).toBeNull();
    expect(productPageChange("POST", "/_emdash/api/content/products/%E0%A4%A/publish")).toBeNull();
  });

  it("puts the product on sale after a successful publish, as the person who published", async () => {
    const rt = runtime({ commerce_item_id: " item-1 " });
    const response = await withProductOnSale(input("POST", "/_emdash/api/content/products/hat/publish", rt), async () => new Response("{}", { status: 200 }));
    expect(response.status).toBe(200);
    expect(rt.calls).toEqual([{ pluginId: "r_commerce", path: "catalog-items/set-on-sale", body: { catalogItemId: "item-1", entryId: "01PAGE", onSale: true }, user }]);
  });

  it("takes it back to Draft on unpublish, and drops the link on trash", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 200 }));
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), async () => new Response(null, { status: 200 }));
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false, deleted: true },
    ]);
  });

  it("tells Commerce nothing when the page change failed, the page sells nothing, or nobody is signed in", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(null, { status: 409 }));
    const empty = runtime({ commerce_item_id: "" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", empty), async () => new Response(null, { status: 200 }));
    const anonymous = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", anonymous, null), async () => new Response(null, { status: 200 }));
    expect([...rt.calls, ...empty.calls, ...anonymous.calls]).toEqual([]);
    expect(anonymous.handleContentGet).not.toHaveBeenCalled();
  });

  it("keeps the page change when Commerce refuses or is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = runtime({ commerce_item_id: "item-1" }, { success: false, data: undefined as never, error: { message: "forbidden" } } as never);
    const ok = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", refused), async () => new Response("published", { status: 200 }));
    expect(await ok.text()).toBe("published");
    const broken = runtime({ commerce_item_id: "item-1" });
    broken.handlePluginApiRoute.mockRejectedValueOnce(new Error("no route"));
    const still = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", broken), async () => new Response(null, { status: 200 }));
    expect(still.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("leaves every other request alone", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    await withProductOnSale(input("GET", "/products/hat", rt), next);
    expect(next).toHaveBeenCalledOnce();
    expect(rt.handleContentGet).not.toHaveBeenCalled();
  });
});
