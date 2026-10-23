import { describe, expect, it, vi } from "vitest";

import { productPageChange, withProductOnSale } from "../../src/features/product-on-sale/index.js";

const user = { id: "u1", email: "owner@example.test", name: null, role: 50, createdAt: "2026-10-23T00:00:00.000Z" };

function runtime(fields: Record<string, unknown> | null, result = { success: true, data: { changed: true } }, status = "published") {
  const calls: Array<{ pluginId: string; path: string; body: unknown; user: unknown }> = [];
  return {
    calls,
    handleContentGet: vi.fn(async (_collection: string, id: string) =>
      fields ? { success: true, data: { item: { id: "01PAGE", slug: id, status, data: fields } } } : { success: false, error: { code: "NOT_FOUND", message: "not found" } }),
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

  it("takes the product off sale before unpublish, and drops the link after trash", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    const order: string[] = [];
    rt.handlePluginApiRoute.mockImplementation(async (_p: string, _m: string, _path: string, request: Request) => {
      order.push("commerce " + JSON.stringify(await request.json()));
      return { success: true, data: { changed: true } };
    });
    const page = async () => { order.push("cms"); return new Response(null, { status: 200 }); };
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), page);
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), page);
    expect(order).toEqual([
      'commerce {"catalogItemId":"item-1","entryId":"01PAGE","onSale":false}', "cms",
      'commerce {"catalogItemId":"item-1","entryId":"01PAGE","onSale":false}', "cms",
      'commerce {"catalogItemId":"item-1","entryId":"01PAGE","onSale":false,"deleted":true}',
    ]);
  });

  it("tells Commerce nothing when the page change failed, the page sells nothing, or nobody is signed in", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(null, { status: 409 }));
    const empty = runtime({ commerce_item_id: "" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", empty), async () => new Response(null, { status: 200 }));
    const anonymous = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", anonymous, null), async () => new Response(null, { status: 200 }));
    expect([...rt.calls, ...empty.calls, ...anonymous.calls]).toEqual([]);
    expect(anonymous.handleContentGet).not.toHaveBeenCalled();
  });

  it("refuses unpublish and trash, changing nothing, when Commerce refuses or is unavailable", async () => {
    const refused = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } } as never);
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", refused), cms);
    expect(out.status).toBe(503);
    expect((await out.json()).error.code).toBe("COMMERCE_UNAVAILABLE");
    const broken = runtime({ commerce_item_id: "item-1" });
    broken.handlePluginApiRoute.mockRejectedValueOnce(new Error("down"));
    expect((await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", broken), cms)).status).toBe(503);
    expect(cms).not.toHaveBeenCalled();
  });

  it("lets a page that does not own its product, or a store without the publish check, change freely", async () => {
    for (const code of ["PRODUCT_PAGE_CONFLICT", "NOT_FOUND", "ROUTE_NOT_FOUND"]) {
      const rt = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code, message: code } } as never);
      const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
      expect(await out.text()).toBe("done");
    }
  });

  it("lets a sandboxed Commerce's conflict through by its reason", async () => {
    const rt = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code: "ROUTE_ERROR", message: "Another page sells this product" } } as never);
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
    expect(out.status).toBe(200);
  });

  it("puts the product back on sale when the page change fails after Commerce took it off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ commerce_item_id: "item-1" }, { success: true, data: { changed: true } });
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(out.status).toBe(409);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
    ]);
    // A product that was already off sale is left alone.
    const draft = runtime({ commerce_item_id: "item-1" }, { success: true, data: { changed: false } });
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", draft), async () => new Response(null, { status: 500 }));
    expect(draft.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-1", entryId: "01PAGE", onSale: false }]);
    warn.mockRestore();
  });

  it("never undoes someone else's unpublish: the page is read again before the product goes back on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ commerce_item_id: "item-1" }, { success: true, data: { changed: true } });
    // Our unpublish fails, but by then another request has unpublished the page.
    const contentGet = rt.handleContentGet.getMockImplementation()!;
    rt.handleContentGet.mockImplementationOnce(contentGet).mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { commerce_item_id: "item-1" } } } }) as never);
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(out.status).toBe(409);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-1", entryId: "01PAGE", onSale: false }]);
    warn.mockRestore();
  });

  it("puts the product back when the page handler throws, and rethrows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ commerce_item_id: "item-1" }, { success: true, data: { changed: true } });
    await expect(withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), async () => { throw new Error("db gone"); })).rejects.toThrow("db gone");
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
    ]);
    warn.mockRestore();
  });

  it("refuses unpublish and trash when the page cannot be read, and lets a missing page through", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    rt.handleContentGet.mockResolvedValue({ success: false, error: { code: "INTERNAL_ERROR", message: "db down" } } as never);
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), cms)).status).toBe(503);
    rt.handleContentGet.mockRejectedValueOnce(new Error("boom"));
    expect((await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), cms)).status).toBe(503);
    expect(cms).not.toHaveBeenCalled();
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), cms)).status).toBe(200);
    const missing = runtime(null);
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/gone/unpublish", missing), async () => new Response(null, { status: 404 }))).status).toBe(404);
    expect([...rt.calls, ...missing.calls]).toEqual([]);
  });

  it("keeps a publish when Commerce refuses or is unavailable; the product stays a Draft", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } } as never);
    const ok = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", refused), async () => new Response("published", { status: 200 }));
    expect(await ok.text()).toBe("published");
    const broken = runtime({ commerce_item_id: "item-1" });
    broken.handlePluginApiRoute.mockRejectedValueOnce(new Error("no route"));
    const still = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", broken), async () => new Response(null, { status: 200 }));
    expect(still.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("only someone who may publish all content changes a product's sale state", async () => {
    const author = { ...user, role: 30 };
    const rt = runtime({ commerce_item_id: "item-1" });
    const published = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt, author), async () => new Response(null, { status: 200 }));
    expect(published.status).toBe(200);
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    const unpublished = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt, author), cms);
    expect(unpublished.status).toBe(403);
    expect(cms).not.toHaveBeenCalled();
    expect(rt.calls).toEqual([]);
  });

  it("leaves every other request alone", async () => {
    const rt = runtime({ commerce_item_id: "item-1" });
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    await withProductOnSale(input("GET", "/products/hat", rt), next);
    expect(next).toHaveBeenCalledOnce();
    expect(rt.handleContentGet).not.toHaveBeenCalled();
  });
});
