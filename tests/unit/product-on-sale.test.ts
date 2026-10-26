import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { productName, productPageChange, scheduledSaleSweeper, sellScheduledPages, withProductOnSale } from "../../src/features/product-on-sale/index.js";

const user = { id: "u1", email: "owner@example.test", name: null, role: 50, createdAt: "2026-10-23T00:00:00.000Z" };

function runtime(fields: Record<string, unknown> | null, result = { success: true, data: { changed: true } }, status = "published") {
  const calls: Array<{ pluginId: string; path: string; body: unknown; user: unknown }> = [];
  return {
    calls,
    // Commerce 0.6.0 declares the route and its permission, native and sandboxed alike.
    getPluginRouteMeta: vi.fn((_pluginId: string, path: string): { public: boolean; permission?: string } | null =>
      path === "catalog-items/set-on-sale" ? { public: false, permission: "content:publish_any" } : null),
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

  it("names the product from the title EmDash just published (catalog-page-title-is-name-20261026)", async () => {
    const rt = runtime({ commerce_item_id: "item-1", title: "Renamed mug" });
    // Read before the publish, the page still shows its old title.
    rt.handleContentGet.mockResolvedValueOnce({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { commerce_item_id: "item-1", title: "Old mug" } } } });
    const published = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: " Renamed\tmug ", commerce_item_id: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(published, { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-1", entryId: "01PAGE", onSale: true, name: "Renamed mug" }]);
    // An answer with no readable title sends no name, never the title read before the publish; the read after
    // the write supplies the published one.
    const quiet = runtime({ commerce_item_id: "item-1", title: "Renamed mug" });
    quiet.handleContentGet.mockResolvedValueOnce({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { commerce_item_id: "item-1", title: "Old mug" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", quiet), async () => new Response("not json", { status: 200 }));
    expect(quiet.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
      { catalogItemId: "item-1", entryId: "01PAGE", name: "Renamed mug" },
    ]);
  });

  it("settles on the newest published title when an older publish's write lands last", async () => {
    // Publish A answered "Title A", but publish B ("Title B") landed meanwhile: A's read after its write sees B and
    // renames the product to B with a title-only write, so A's late write never leaves the older name.
    const rt = runtime({ commerce_item_id: "item-1", title: "Title B" });
    const answered = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: "Title A", commerce_item_id: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(answered, { status: 200 }));
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true, name: "Title A" },
      { catalogItemId: "item-1", entryId: "01PAGE", name: "Title B" },
    ]);
    // A title that keeps changing gets at most three title-only writes from one request; the rest is listed for
    // the sweep, which finishes it.
    let n = 0;
    const churn = runtime({ commerce_item_id: "item-1" });
    churn.handleContentGet.mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { commerce_item_id: "item-1", title: `T${n++}` } } } }));
    const listed: Array<[string, unknown]> = [];
    const pendingSales = { put: async (id: string, value: unknown) => void listed.push([id, value]) } as never;
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", churn), pendingSales }, async () => new Response(answered, { status: 200 }));
    expect(churn.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true, name: "Title A" },
      { catalogItemId: "item-1", entryId: "01PAGE", name: "T1" },
      { catalogItemId: "item-1", entryId: "01PAGE", name: "T2" },
      { catalogItemId: "item-1", entryId: "01PAGE", name: "T3" },
    ]);
    expect(listed).toEqual([[`retitle:01PAGE:${createHash("sha256").update("item-1").digest("hex")}`, { retitle: true, entryId: "01PAGE", catalogItemId: "item-1" }]]);
  });

  it("catches up a title only with title-only writes, which never put a product back on sale", async () => {
    // Publish A put the product on sale; an unpublish then took it off and an Author published the page again as
    // "Author title". A's read sees that title: it renames the product, and never writes onSale again.
    const rt = runtime({ commerce_item_id: "item-1", title: "Author title" });
    const answered = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: "Title A", commerce_item_id: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(answered, { status: 200 }));
    expect(rt.calls.filter((call) => (call.body as { onSale?: boolean }).onSale === true)).toHaveLength(1);
    expect(rt.calls.at(-1)?.body).toEqual({ catalogItemId: "item-1", entryId: "01PAGE", name: "Author title" });
    // Commerce 0.6.0 refuses title-only writes as INVALID_INPUT: nothing is listed and nothing else is written.
    const old = runtime({ commerce_item_id: "item-1", title: "Title B" });
    old.handlePluginApiRoute.mockImplementation(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as Record<string, unknown>;
      old.calls.push({ pluginId, path, body, user: caller });
      return body.onSale === undefined ? { success: false, error: { code: "INVALID_INPUT", message: "Invalid onSale" } } as never : { success: true, data: { changed: true } };
    });
    const listed: unknown[] = [];
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", old), pendingSales: { put: async (id: string) => void listed.push(id) } as never },
      async () => new Response(answered, { status: 200 }));
    expect(old.calls).toHaveLength(2);
    expect(listed).toEqual([]);
    // A sandboxed Commerce 0.6.0 carries the reason only in its message.
    old.calls.length = 0;
    old.handlePluginApiRoute.mockImplementation(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as Record<string, unknown>;
      old.calls.push({ pluginId, path, body, user: caller });
      return body.onSale === undefined ? { success: false, error: { code: "PLUGIN_ROUTE_ERROR", message: "Plugin r_commerce:0.6.0 route catalog-items/set-on-sale failed: Invalid onSale" } } as never : { success: true, data: { changed: true } };
    });
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", old), pendingSales: { put: async (id: string) => void listed.push(id) } as never },
      async () => new Response(answered, { status: 200 }));
    expect(old.calls).toHaveLength(2);
    expect(listed).toEqual([]);
  });

  it("keeps a product name within Commerce's rules", () => {
    expect(productName("  Mug\u0007 one\n")).toBe("Mug one");
    expect(productName("\uFF2D\uFF55\uFF47")).toBe("Mug");
    expect(productName("x".repeat(200))).toHaveLength(160);
    expect(productName(" \u0000 ")).toBeUndefined();
    expect(productName(42)).toBeUndefined();
  });

  it("puts a product back on sale under its live title, not a newer unsaved draft's", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ commerce_item_id: "item-1" });
    rt.handleContentGet.mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published",
      data: { commerce_item_id: "item-1", title: "Draft title" }, liveData: { commerce_item_id: "item-1", title: "Live title" } } } }) as never);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true, name: "Live title" },
    ]);
    warn.mockRestore();
  });

  it("takes the product off sale before and after unpublish, and drops the link after trash", async () => {
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
      'commerce {"catalogItemId":"item-1","entryId":"01PAGE","onSale":false}',
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

  it("lets a page that does not own its product, or whose product or plugin is gone, change freely", async () => {
    for (const code of ["PRODUCT_PAGE_CONFLICT", "NOT_FOUND", "CATALOG_ITEM_NOT_FOUND", "ROUTE_NOT_FOUND"]) {
      const rt = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code, message: code } } as never);
      const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
      expect(await out.text()).toBe("done");
    }
  });

  it("lets a sandboxed Commerce's conflict or gone product through by its reason", async () => {
    for (const message of ["Another page sells this product", "Product not found. Return to Products."]) {
      const rt = runtime({ commerce_item_id: "item-1" }, { success: false, error: { code: "ROUTE_ERROR", message } } as never);
      const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
      expect(out.status).toBe(200);
    }
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

  it("takes the product off sale again when the page was unpublished while it was being put on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const draft = async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { commerce_item_id: "item-1" } } } }) as never;
    // Our publish succeeds; another request unpublishes the page before our on-sale write is read back.
    const published = runtime({ commerce_item_id: "item-1" });
    published.handleContentGet.mockImplementationOnce(published.handleContentGet.getMockImplementation()!).mockImplementation(draft);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", published), async () => new Response(null, { status: 200 }));
    expect(published.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
    ]);
    // Our unpublish fails and the page still reads as published, but another unpublish lands before our undo is read back.
    const undone = runtime({ commerce_item_id: "item-1" });
    const get = undone.handleContentGet.getMockImplementation()!;
    undone.handleContentGet.mockImplementationOnce(get).mockImplementationOnce(get).mockImplementation(draft);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", undone), async () => new Response(null, { status: 409 }));
    expect(undone.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
    ]);
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

  it("leaves an older Commerce without the route alone, so Authors still unpublish and trash their own pages", async () => {
    const author = { ...user, role: 30 };
    // Native Commerce 0.5.0 has no such route (null); a sandboxed 0.5.0 answers only that the plugin exists.
    for (const meta of [null, { public: false }]) {
      const rt = runtime({ commerce_item_id: "item-1" });
      rt.getPluginRouteMeta.mockReturnValue(meta);
      for (const [method, path] of [["POST", "/_emdash/api/content/products/01PAGE/unpublish"], ["DELETE", "/_emdash/api/content/products/01PAGE"], ["POST", "/_emdash/api/content/products/01PAGE/publish"]]) {
        const out = await withProductOnSale(input(method, path, rt, author), async () => new Response("done", { status: 200 }));
        expect(await out.text()).toBe("done");
      }
      expect(rt.handlePluginApiRoute).not.toHaveBeenCalled();
      expect(rt.handleContentGet).not.toHaveBeenCalled();
    }
  });

  it("checks the person as stored now before every write that can make a product buyable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const author = { ...user, role: 30 };
    // Admin when the publish starts, an Author by the time the product would go on sale.
    const publish = runtime({ commerce_item_id: "item-1" });
    const asPublished = [user, author];
    const out = await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", publish), currentUser: async () => asPublished.shift() ?? author },
      async () => new Response(null, { status: 200 }));
    expect(out.status).toBe(200);
    expect(publish.calls).toEqual([]);
    // Disabled or deleted (no stored person) before an unpublish: refused, nothing changes.
    const unpublish = runtime({ commerce_item_id: "item-1" });
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    const refused = await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/unpublish", unpublish), currentUser: async () => null }, cms);
    expect(refused.status).toBe(403);
    expect(cms).not.toHaveBeenCalled();
    expect(unpublish.calls).toEqual([]);
    // Lost after the first off-sale write and a failed page change: the product is not put back on sale.
    const undo = runtime({ commerce_item_id: "item-1" });
    const asUndone = [user, user];
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/unpublish", undo), currentUser: async () => asUndone.shift() ?? null },
      async () => new Response(null, { status: 409 }));
    expect(undo.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-1", entryId: "01PAGE", onSale: false }]);
    // Lost right after the on-sale write while the page was unpublished: taking it off sale again still runs.
    const corrective = runtime({ commerce_item_id: "item-1" });
    corrective.handleContentGet.mockImplementationOnce(corrective.handleContentGet.getMockImplementation()!)
      .mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { commerce_item_id: "item-1" } } } }) as never);
    const asCorrected = [user, user];
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", corrective), currentUser: async () => asCorrected.shift() ?? null },
      async () => new Response(null, { status: 200 }));
    expect(corrective.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
    ]);
    // Every write that does run carries the person as stored at that moment.
    const fresh = { ...user, name: "Stored now" };
    const carried = runtime({ commerce_item_id: "item-1" });
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", carried), currentUser: async () => fresh }, async () => new Response(null, { status: 200 }));
    expect(carried.calls.map((call) => call.user)).toEqual([fresh]);
    warn.mockRestore();
  });

  it("takes the product off sale again when the page was linked to another product while it was being put on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const relinked = runtime({ commerce_item_id: "item-1" });
    relinked.handleContentGet.mockImplementationOnce(relinked.handleContentGet.getMockImplementation()!)
      .mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "published", data: { commerce_item_id: "item-2" } } } }) as never);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", relinked), async () => new Response(null, { status: 200 }));
    expect(relinked.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: true },
      { catalogItemId: "item-1", entryId: "01PAGE", onSale: false },
    ]);
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

describe("pages EmDash published on a schedule go on sale on an allowed person's next request", () => {
  const author = { ...user, id: "u2", role: 30 };
  const people: Record<string, unknown> = { u1: user, u2: author };
  const now = Date.parse("2026-10-25T12:00:00.000Z");

  class Pending {
    rows = new Map<string, { value: Record<string, unknown>; revision: string }>();
    pageSize = 50;
    private next = 0;
    put(id: string, value: Record<string, unknown>): Promise<void> {
      this.rows.set(id, { value, revision: `r${(this.next += 1)}` });
      return Promise.resolve();
    }
    async query({ limit, cursor }: { limit: number; cursor?: string }) {
      const ids = [...this.rows.keys()];
      const from = cursor ? ids.indexOf(cursor) + 1 : 0;
      const size = Math.min(limit, this.pageSize);
      const items = ids.slice(from, from + size).map((id) => ({ id }));
      return { items, cursor: from + size < ids.length ? items.at(-1)?.id : undefined };
    }
    async getVersioned(id: string) {
      return this.rows.get(id) ?? null;
    }
    async compareAndDelete(id: string, revision: string) {
      const applied = this.rows.get(id)?.revision === revision;
      if (applied) this.rows.delete(id);
      return { applied };
    }
    value(id: string) {
      return this.rows.get(id)?.value;
    }
  }

  // The take-back key the sweep lists: the page, then the product's SHA-256.
  const takebackOf = async (entryId: string, itemId: string) =>
    `takeback:${entryId}:${createHash("sha256").update(itemId).digest("hex")}`;
  type Page = { status: string; scheduledAt?: string | null; item?: string; title?: string };
  function site(pages: Record<string, Page>, result: unknown = { success: true, data: { changed: true } }) {
    const rt = runtime({ commerce_item_id: "item-1" }, result as never);
    rt.handleContentGet.mockImplementation(async (_collection: string, id: string) => {
      const page = pages[id];
      return page
        ? { success: true, data: { item: { id, slug: id, status: page.status, scheduledAt: page.scheduledAt ?? null, data: { commerce_item_id: page.item ?? `item-${id}`, ...(page.title ? { title: page.title } : {}) } } } }
        : { success: false, error: { code: "NOT_FOUND", message: "not found" } };
    });
    return rt;
  }
  // A record as the product-url plugin leaves it once EmDash's scheduled publish succeeded.
  const sale = (id: string, by = "u1", role = 50, state = "published", updatedAt = "2026-10-25T11:59:00.000Z") =>
    ({ entryId: id, proposed: null, confirmed: { by, role, itemId: `item-${id}`, scheduledAt: "2026-10-25T11:59:30.000Z" }, state, updatedAt });
  const sweep = (rt: ReturnType<typeof runtime>, pending: Pending, extra: Record<string, unknown> = {}, cursor?: string) =>
    sellScheduledPages({ url: new URL("https://shop.example.test/_emdash/admin"), runtime: rt, user, commercePluginId: "r_commerce", pendingSales: pending, userById: async (id: string) => people[id] ?? null, ...extra }, now, () => true, cursor);

  it("puts a page an admin scheduled on sale once EmDash's scheduled publish succeeded, as the visiting admin", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([{ pluginId: "r_commerce", path: "catalog-items/set-on-sale", body: { catalogItemId: "item-hat", entryId: "hat", onSale: true }, user }]);
    expect(pending.rows.size).toBe(0);
  });

  it("names a scheduled page's product from its published title", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published", title: "Sun hat" } });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-hat", entryId: "hat", onSale: true, name: "Sun hat" }]);
  });

  it("writes a scheduled page's newer title when a publish renamed it during the sweep", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const pages = { hat: { status: "published", title: "Sun hat" } };
    const rt = site(pages);
    const commerce = rt.handlePluginApiRoute.getMockImplementation()!;
    rt.handlePluginApiRoute.mockImplementation(async (...args: Parameters<typeof commerce>) => {
      const answer = await commerce(...args);
      pages.hat.title = "Straw hat";
      return answer;
    });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-hat", entryId: "hat", onSale: true, name: "Sun hat" },
      { catalogItemId: "item-hat", entryId: "hat", name: "Straw hat" },
    ]);
    expect(pending.rows.size).toBe(0);
  });

  it("writes a scheduled page's newer title only for a visitor who still holds the permission", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const pages = { hat: { status: "published", title: "Sun hat" } };
    const rt = site(pages);
    const commerce = rt.handlePluginApiRoute.getMockImplementation()!;
    rt.handlePluginApiRoute.mockImplementation(async (...args: Parameters<typeof commerce>) => {
      const answer = await commerce(...args);
      pages.hat.title = "Straw hat";
      return answer;
    });
    let reads = 0;
    // The visitor is an admin for the first sale write and an Author by the correction.
    const demoted = async () => (reads++ === 0 ? user : { ...user, role: 30 });
    await sweep(rt, pending, { currentUser: demoted });
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-hat", entryId: "hat", onSale: true, name: "Sun hat" }]);
    // The newer title is listed instead, and an allowed visitor's later sweep renames the product with it.
    const retitle = `retitle:hat:${createHash("sha256").update("item-hat").digest("hex")}`;
    expect([...pending.rows.keys()]).toEqual([retitle]);
    await sweep(rt, pending, { currentUser: demoted });
    expect(rt.calls).toHaveLength(1);
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body).at(-1)).toEqual({ catalogItemId: "item-hat", entryId: "hat", name: "Straw hat" });
    expect(pending.rows.size).toBe(0);
  });

  it("finishes a listed title with title-only writes, keeping it until Commerce has it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = (id: string) => `retitle:${id}:${createHash("sha256").update(`item-${id}`).digest("hex")}`;
    const listing = (id: string) => ({ retitle: true, entryId: id, catalogItemId: `item-${id}` });
    const pending = new Pending();
    for (const id of ["hat", "cap", "mug", "tee"]) pending.put(key(id), listing(id));
    // The cap's page was unpublished and the mug's sells another product: nothing to rename. The tee has no title.
    const rt = site({ hat: { status: "published", title: "Straw hat" }, cap: { status: "draft", title: "Cap" }, mug: { status: "published", item: "other", title: "Mug" }, tee: { status: "published" } },
      { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "down" } });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-hat", entryId: "hat", name: "Straw hat" }]);
    expect([...pending.rows.keys()]).toEqual([key("hat")]);
    // Commerce answers on a later sweep, and the listing goes.
    rt.handlePluginApiRoute.mockImplementation(async () => ({ success: true, data: { changed: false } }));
    await sweep(rt, pending);
    expect(pending.rows.size).toBe(0);
    warn.mockRestore();
  });

  it("sells nothing before EmDash's scheduled publish has succeeded, or for a schedule that was never confirmed", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat", "u1", 50, "scheduled"));
    pending.put("cap", sale("cap", "u1", 50, "publishing"));
    // A failed reschedule of a page that was already live: proposed, never confirmed.
    pending.put("tee", { entryId: "tee", proposed: { by: "u1", role: 50, itemId: "item-tee", scheduledAt: "2026-10-26T00:00:00.000Z" }, confirmed: null, state: "scheduled", updatedAt: "2026-10-25T11:59:00.000Z" });
    const rt = site({ hat: { status: "published" }, cap: { status: "published" }, tee: { status: "published" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    // Kept while they may still be in progress, dropped once stale.
    expect(pending.rows.size).toBe(3);
    await sellScheduledPages({ url: new URL("https://shop.example.test/"), runtime: rt, user, commercePluginId: "r_commerce", pendingSales: pending, userById: async (id: string) => people[id] ?? null }, now + 11 * 60_000);
    expect(rt.calls).toEqual([]);
    expect(pending.rows.size).toBe(0);
  });

  it("leaves a page that is scheduled again, and keeps its record", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published", scheduledAt: "2026-10-26T00:00:00.000Z" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    expect(pending.rows.size).toBe(1);
  });

  it("drops an Author's schedule, or one by someone who has since lost the permission or gained it only later", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat", "u2", 30));
    pending.put("cap", sale("cap", "gone"));
    pending.put("tee", sale("tee", "u1", 30));
    const rt = site({ hat: { status: "published" }, cap: { status: "published" }, tee: { status: "published" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    expect(pending.rows.size).toBe(0);
  });

  it("does nothing for a visitor without the permission, or with a Commerce that has no publish check", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published" } });
    await sweep(rt, pending, { user: author });
    // The session says admin, but the person as stored now is an Author.
    await sweep(rt, pending, { currentUser: async () => author });
    const older = site({ hat: { status: "published" } });
    older.getPluginRouteMeta.mockReturnValue(null);
    await sweep(older, pending);
    expect([...rt.calls, ...older.calls]).toEqual([]);
    expect(pending.rows.size).toBe(1);
  });

  it("drops records whose page is gone, unpublished, or sells another product", async () => {
    const pending = new Pending();
    pending.put("gone", sale("gone"));
    pending.put("relinked", sale("relinked"));
    pending.put("draft", sale("draft"));
    const rt = site({ relinked: { status: "published", item: "item-other" }, draft: { status: "draft" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    expect(pending.rows.size).toBe(0);
  });

  it("sells nothing when the record was removed or replaced after it was read", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    pending.put("cap", sale("cap"));
    const rt = site({ hat: { status: "published" }, cap: { status: "published" } });
    let reads = 0;
    // A person's own publish removes one record, and a new schedule replaces the other, while the sweep reads the visitor.
    const visitor = async () => {
      reads += 1;
      if (reads === 1) pending.rows.delete("hat");
      if (reads === 2) pending.put("cap", sale("cap", "u2", 30, "scheduled"));
      return user;
    };
    await sweep(rt, pending, { currentUser: visitor });
    expect(rt.calls).toEqual([]);
    expect(pending.value("cap")).toMatchObject({ state: "scheduled" });
  });

  it("takes the product off sale again when the record or page changes while it goes on sale", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    pending.put("cap", sale("cap"));
    const pages: Record<string, Page> = { hat: { status: "published" }, cap: { status: "published" } };
    const rt = site(pages);
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as { entryId: string; onSale: boolean };
      rt.calls.push({ pluginId, path, body, user: caller });
      // At the on-sale write: hat's record is removed (a person's own publish), cap is unpublished.
      if (body.onSale && body.entryId === "hat") pending.rows.delete("hat");
      if (body.onSale && body.entryId === "cap") pages.cap = { status: "draft" };
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-hat", entryId: "hat", onSale: true },
      { catalogItemId: "item-hat", entryId: "hat", onSale: false },
      { catalogItemId: "item-cap", entryId: "cap", onSale: true },
      { catalogItemId: "item-cap", entryId: "cap", onSale: false },
    ]);
    expect(pending.rows.size).toBe(0);
  });

  it("sells nothing on a record that one write of the same sweep removed after it was read", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    pending.put("cap", sale("cap"));
    const rt = site({ hat: { status: "published" }, cap: { status: "published" } });
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as { entryId: string; onSale: boolean };
      rt.calls.push({ pluginId, path, body, user: caller });
      if (body.onSale) pending.rows.delete("cap");
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-hat", entryId: "hat", onSale: true }]);
  });

  it("keeps taking a product off sale again on later sweeps until Commerce confirms it, never selling it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published" } });
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as { onSale: boolean };
      rt.calls.push({ pluginId, path, body, user: caller });
      if (body.onSale) {
        pending.rows.delete("hat");
        return { success: true, data: { changed: true } };
      }
      return { success: false, error: { code: "INTERNAL_ERROR", message: "down" } } as never;
    });
    await sweep(rt, pending);
    expect([...pending.rows.keys()]).toEqual([await takebackOf("hat", "item-hat")]);
    // A later sweep retries only the off-sale write; it stays listed while Commerce refuses, then clears.
    await sweep(rt, pending);
    expect([...pending.rows.keys()]).toEqual([await takebackOf("hat", "item-hat")]);
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      rt.calls.push({ pluginId, path, body: await request.json(), user: caller });
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(pending.rows.size).toBe(0);
    expect(rt.calls.map((call) => (call.body as { onSale: boolean }).onSale)).toEqual([true, false, false, false]);
    warn.mockRestore();
  });

  it("removes only the take-back listing its own off-sale write answered", async () => {
    const pending = new Pending();
    // Two products to take off sale for one page (it was relinked meanwhile), listed separately.
    const oldKey = await takebackOf("hat", "item-old");
    const newKey = await takebackOf("hat", "item-new");
    pending.put(oldKey, { takeback: true, catalogItemId: "item-old", entryId: "hat" });
    pending.put(newKey, { takeback: true, catalogItemId: "item-new", entryId: "hat" });
    const rt = site({});
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as { catalogItemId: string };
      rt.calls.push({ pluginId, path, body, user: caller });
      // While the old product's write is in flight, another sweep lists the old product again, and the new
      // product's write fails.
      if (body.catalogItemId === "item-old" && rt.calls.length === 1) pending.put(oldKey, { takeback: true, catalogItemId: "item-old", entryId: "hat" });
      return body.catalogItemId === "item-new"
        ? { success: false, error: { code: "INTERNAL_ERROR", message: "down" } } as never
        : { success: true, data: { changed: true } };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sweep(rt, pending);
    // The old write answered the first listing only; the newer listing and the refused one both stay.
    expect([...pending.rows.keys()].sort()).toEqual([newKey, oldKey].sort());
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      rt.calls.push({ pluginId, path, body: await request.json(), user: caller });
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(pending.rows.size).toBe(0);
    expect(rt.calls.every((call) => (call.body as { onSale: boolean }).onSale === false)).toBe(true);
    warn.mockRestore();
  });

  it("keeps the record to retry when Commerce refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    await sweep(site({ hat: { status: "published" } }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } }), pending);
    expect(pending.rows.size).toBe(1);
    warn.mockRestore();
  });

  it("reaches every record a batch per sweep, however many wait", async () => {
    const pending = new Pending();
    pending.pageSize = 2;
    const pages: Record<string, Page> = {};
    for (const id of ["a", "b", "c", "d"]) {
      pending.put(id, sale(id));
      pages[id] = { status: "scheduled", scheduledAt: "2026-10-26T00:00:00.000Z" };
    }
    pending.put("live", sale("live"));
    pages.live = { status: "published" };
    const rt = site(pages);
    const sweeper = scheduledSaleSweeper(60_000);
    const base = { url: new URL("https://shop.example.test/"), runtime: rt, user, commercePluginId: "r_commerce", pendingSales: pending, userById: async (id: string) => people[id] ?? null };
    for (let minute = 0; minute < 3; minute += 1) await sweeper(base, now + minute * 60_001);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "item-live", entryId: "live", onSale: true }]);
    expect([...pending.rows.keys()]).toEqual(["a", "b", "c", "d"]);
  });

  it("checks at most once a minute, counting only allowed people's requests", async () => {
    const pending = new Pending();
    const query = vi.spyOn(pending, "query");
    const sweeper = scheduledSaleSweeper(60_000);
    const base = { url: new URL("https://shop.example.test/"), runtime: site({}), commercePluginId: "r_commerce", pendingSales: pending };
    await sweeper({ ...base, user: author }, now);
    await sweeper({ ...base, user }, now + 1);
    await sweeper({ ...base, user }, now + 30_000);
    await sweeper({ ...base, user }, now + 60_002);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
