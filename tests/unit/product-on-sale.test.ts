import { describe, expect, it, vi } from "vitest";

import { productName, productPageChange, withProductOnSale } from "../../src/features/product-on-sale/index.js";

const user = { id: "u1", email: "owner@example.test", name: null, role: 50, createdAt: "2026-10-23T00:00:00.000Z" };

/**
 * A store whose Commerce links each page to a product. The page fixtures stand in for Commerce's answer with
 * `sells`: the private `catalog` route's `get` answers, for the page just read, the product `sells` names (none when
 * it is empty). Those lookups are kept in `lookups`; every other Commerce call goes to `commerce`, kept in `calls`.
 * `ownCatalog` hands the catalog route to `commerce` too.
 */
function runtime(fields: Record<string, unknown> | null, result = { success: true, data: { changed: true } }, status = "published") {
  const calls: Array<{ pluginId: string; path: string; body: unknown; user: unknown }> = [];
  const lookups: Array<{ body: unknown; user: unknown }> = [];
  const rt = {
    calls,
    lookups,
    ownCatalog: false,
    // Commerce declares the publish check's route with its permission, and the private catalog route.
    getPluginRouteMeta: vi.fn((_pluginId: string, path: string): { public: boolean; permission?: string } | null =>
      path === "catalog-items/set-on-sale" || path === "catalog" ? { public: false, permission: "content:publish_any" } : null),
    handleContentGet: vi.fn(async (_collection: string, id: string) =>
      fields ? { success: true, data: { item: { id: "01PAGE", slug: id, status, data: fields } } } : { success: false, error: { code: "NOT_FOUND", message: "not found" } }),
    commerce: vi.fn(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      calls.push({ pluginId, path, body: await request.json(), user: caller });
      return result;
    }),
    async handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, caller: unknown) {
      if (path !== "catalog" || rt.ownCatalog) return rt.commerce(pluginId, method, path, request, caller);
      const body = await request.json();
      lookups.push({ body, user: caller });
      // The store reads the page, then asks Commerce for its product: answer for the page read last.
      const read = await (rt.handleContentGet.mock.results.at(-1)?.value as Promise<unknown> | undefined)?.catch(() => null);
      const item = (read as { data?: { item?: { data?: { sells?: unknown } } } } | null)?.data?.item;
      const sells = typeof item?.data?.sells === "string" ? item.data.sells.trim() : "";
      return { success: true, data: { product: sells ? { catalogItemId: sells, name: "Hat" } : null } };
    },
  };
  return rt;
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
    const rt = runtime({ sells: " item-1 " });
    const response = await withProductOnSale(input("POST", "/_emdash/api/content/products/hat/publish", rt), async () => new Response("{}", { status: 200 }));
    expect(response.status).toBe(200);
    expect(rt.calls).toEqual([{ pluginId: "r_commerce", path: "catalog-items/set-on-sale", body: { entryId: "01PAGE", onSale: true }, user }]);
  });

  it("names the product from the title EmDash just published (catalog-page-title-is-name-20261026)", async () => {
    const rt = runtime({ sells: "item-1", title: "Renamed mug" });
    // Read before the publish, the page still shows its old title.
    rt.handleContentGet.mockResolvedValueOnce({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { sells: "item-1", title: "Old mug" } } } });
    const published = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: " Renamed\tmug ", sells: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(published, { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(rt.calls.map((call) => call.body)).toEqual([{ entryId: "01PAGE", onSale: true, name: "Renamed mug" }]);
    // An answer with no readable title sends no name, never the title read before the publish; the read after
    // the write supplies the published one.
    const quiet = runtime({ sells: "item-1", title: "Renamed mug" });
    quiet.handleContentGet.mockResolvedValueOnce({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { sells: "item-1", title: "Old mug" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", quiet), async () => new Response("not json", { status: 200 }));
    expect(quiet.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true },
      { entryId: "01PAGE", name: "Renamed mug" },
    ]);
  });

  it("settles on the newest published title when an older publish's write lands last", async () => {
    // Publish A answered "Title A", but publish B ("Title B") landed meanwhile: A's read after its write sees B and
    // renames the product to B with a title-only write, so A's late write never leaves the older name.
    const rt = runtime({ sells: "item-1", title: "Title B" });
    const answered = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: "Title A", sells: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(answered, { status: 200 }));
    expect(rt.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true, name: "Title A" },
      { entryId: "01PAGE", name: "Title B" },
    ]);
    // A title that keeps changing gets at most three title-only writes from one request; publishing again finishes it.
    let n = 0;
    const churn = runtime({ sells: "item-1" });
    churn.handleContentGet.mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published", data: { sells: "item-1", title: `T${n++}` } } } }));
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", churn), async () => new Response(answered, { status: 200 }));
    expect(churn.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true, name: "Title A" },
      { entryId: "01PAGE", name: "T1" },
      { entryId: "01PAGE", name: "T2" },
      { entryId: "01PAGE", name: "T3" },
    ]);
  });

  it("catches up a title only with title-only writes, which never put a product back on sale", async () => {
    // Publish A put the product on sale; an unpublish then took it off and an Author published the page again as
    // "Author title". A's read sees that title: it renames the product, and never writes onSale again.
    const rt = runtime({ sells: "item-1", title: "Author title" });
    const answered = JSON.stringify({ success: true, data: { item: { id: "01PAGE", status: "published", data: { title: "Title A", sells: "item-1" } } } });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(answered, { status: 200 }));
    expect(rt.calls.filter((call) => (call.body as { onSale?: boolean }).onSale === true)).toHaveLength(1);
    expect(rt.calls.at(-1)?.body).toEqual({ entryId: "01PAGE", name: "Author title" });
    // Commerce 0.6.0 refuses title-only writes as INVALID_INPUT: nothing else is written.
    const old = runtime({ sells: "item-1", title: "Title B" });
    old.commerce.mockImplementation(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as Record<string, unknown>;
      old.calls.push({ pluginId, path, body, user: caller });
      return body.onSale === undefined ? { success: false, error: { code: "INVALID_INPUT", message: "Invalid onSale" } } as never : { success: true, data: { changed: true } };
    });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", old),
      async () => new Response(answered, { status: 200 }));
    expect(old.calls).toHaveLength(2);
    // A sandboxed Commerce 0.6.0 carries the reason only in its message.
    old.calls.length = 0;
    old.commerce.mockImplementation(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as Record<string, unknown>;
      old.calls.push({ pluginId, path, body, user: caller });
      return body.onSale === undefined ? { success: false, error: { code: "PLUGIN_ROUTE_ERROR", message: "Plugin r_commerce:0.6.0 route catalog-items/set-on-sale failed: Invalid onSale" } } as never : { success: true, data: { changed: true } };
    });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", old),
      async () => new Response(answered, { status: 200 }));
    expect(old.calls).toHaveLength(2);
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
    const rt = runtime({ sells: "item-1" });
    rt.handleContentGet.mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", slug: "mug", status: "published",
      data: { sells: "item-1", title: "Draft title" }, liveData: { sells: "item-1", title: "Live title" } } } }) as never);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(rt.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: true, name: "Live title" },
    ]);
    warn.mockRestore();
  });

  it("takes the product off sale before and after unpublish or soft trash, keeping its link", async () => {
    const rt = runtime({ sells: "item-1" });
    const order: string[] = [];
    rt.commerce.mockImplementation(async (_p: string, _m: string, _path: string, request: Request) => {
      order.push("commerce " + JSON.stringify(await request.json()));
      return { success: true, data: { changed: true } };
    });
    const page = async () => { order.push("cms"); return new Response(null, { status: 200 }); };
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), page);
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), page);
    expect(order).toEqual([
      'commerce {"entryId":"01PAGE","onSale":false}', "cms",
      'commerce {"entryId":"01PAGE","onSale":false}',
      'commerce {"entryId":"01PAGE","onSale":false}', "cms",
      'commerce {"entryId":"01PAGE","onSale":false}',
    ]);
  });

  it("tells Commerce nothing when the page change failed, the page sells nothing, or nobody is signed in", async () => {
    const rt = runtime({ sells: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), async () => new Response(null, { status: 409 }));
    const empty = runtime({ sells: "" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", empty), async () => new Response(null, { status: 200 }));
    const anonymous = runtime({ sells: "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", anonymous, null), async () => new Response(null, { status: 200 }));
    expect([...rt.calls, ...empty.calls, ...anonymous.calls]).toEqual([]);
    expect(anonymous.handleContentGet).not.toHaveBeenCalled();
  });

  it("refuses unpublish and trash, changing nothing, when Commerce refuses or is unavailable", async () => {
    const refused = runtime({ sells: "item-1" }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } } as never);
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", refused), cms);
    expect(out.status).toBe(503);
    expect((await out.json()).error.code).toBe("COMMERCE_UNAVAILABLE");
    const broken = runtime({ sells: "item-1" });
    broken.commerce.mockRejectedValueOnce(new Error("down"));
    expect((await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", broken), cms)).status).toBe(503);
    expect(cms).not.toHaveBeenCalled();
  });

  it("lets a page that does not own its product, or whose product or plugin is gone, change freely", async () => {
    for (const code of ["PRODUCT_PAGE_CONFLICT", "NOT_FOUND", "CATALOG_ITEM_NOT_FOUND", "ROUTE_NOT_FOUND"]) {
      const rt = runtime({ sells: "item-1" }, { success: false, error: { code, message: code } } as never);
      const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
      expect(await out.text()).toBe("done");
    }
  });

  it("lets a sandboxed Commerce's conflict or gone product through by its reason", async () => {
    for (const message of ["Another page sells this product", "Product not found. Return to Products."]) {
      const rt = runtime({ sells: "item-1" }, { success: false, error: { code: "ROUTE_ERROR", message } } as never);
      const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response("done", { status: 200 }));
      expect(out.status).toBe(200);
    }
  });

  it("puts the product back on sale when the page change fails after Commerce took it off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ sells: "item-1" }, { success: true, data: { changed: true } });
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(out.status).toBe(409);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: true },
    ]);
    // A product that was already off sale is left alone.
    const draft = runtime({ sells: "item-1" }, { success: true, data: { changed: false } });
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", draft), async () => new Response(null, { status: 500 }));
    expect(draft.calls.map((call) => call.body)).toEqual([{ entryId: "01PAGE", onSale: false }]);
    warn.mockRestore();
  });

  it("never undoes someone else's unpublish: the page is read again before the product goes back on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ sells: "item-1" }, { success: true, data: { changed: true } });
    // Our unpublish fails, but by then another request has unpublished the page.
    const contentGet = rt.handleContentGet.getMockImplementation()!;
    rt.handleContentGet.mockImplementationOnce(contentGet).mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { sells: "item-1" } } } }) as never);
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), async () => new Response(null, { status: 409 }));
    expect(out.status).toBe(409);
    expect(rt.calls.map((call) => call.body)).toEqual([{ entryId: "01PAGE", onSale: false }]);
    warn.mockRestore();
  });

  it("takes the product off sale again when the page was unpublished while it was being put on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const draft = async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { sells: "item-1" } } } }) as never;
    // Our publish succeeds; another request unpublishes the page before our on-sale write is read back.
    const published = runtime({ sells: "item-1" });
    published.handleContentGet.mockImplementationOnce(published.handleContentGet.getMockImplementation()!).mockImplementation(draft);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", published), async () => new Response(null, { status: 200 }));
    expect(published.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true },
      { entryId: "01PAGE", onSale: false },
    ]);
    // Our unpublish fails and the page still reads as published, but another unpublish lands before our undo is read back.
    const undone = runtime({ sells: "item-1" });
    const get = undone.handleContentGet.getMockImplementation()!;
    undone.handleContentGet.mockImplementationOnce(get).mockImplementationOnce(get).mockImplementation(draft);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", undone), async () => new Response(null, { status: 409 }));
    expect(undone.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: true },
      { entryId: "01PAGE", onSale: false },
    ]);
    warn.mockRestore();
  });

  it("puts the product back when the page handler throws, and rethrows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime({ sells: "item-1" }, { success: true, data: { changed: true } });
    await expect(withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), async () => { throw new Error("db gone"); })).rejects.toThrow("db gone");
    expect(rt.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: true },
    ]);
    warn.mockRestore();
  });

  it("refuses unpublish and trash when the page cannot be read, and lets a missing page through", async () => {
    const rt = runtime({ sells: "item-1" });
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
    const refused = runtime({ sells: "item-1" }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } } as never);
    const ok = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", refused), async () => new Response("published", { status: 200 }));
    expect(await ok.text()).toBe("published");
    const broken = runtime({ sells: "item-1" });
    broken.commerce.mockRejectedValueOnce(new Error("no route"));
    const still = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", broken), async () => new Response(null, { status: 200 }));
    expect(still.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("only someone who may publish all content changes a product's sale state", async () => {
    const author = { ...user, role: 30 };
    const rt = runtime({ sells: "item-1" });
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
      const rt = runtime({ sells: "item-1" });
      rt.getPluginRouteMeta.mockReturnValue(meta);
      for (const [method, path] of [["POST", "/_emdash/api/content/products/01PAGE/unpublish"], ["DELETE", "/_emdash/api/content/products/01PAGE"], ["POST", "/_emdash/api/content/products/01PAGE/publish"]]) {
        const out = await withProductOnSale(input(method, path, rt, author), async () => new Response("done", { status: 200 }));
        expect(await out.text()).toBe("done");
      }
      expect(rt.commerce).not.toHaveBeenCalled();
      expect(rt.lookups).toEqual([]);
      expect(rt.handleContentGet).not.toHaveBeenCalled();
    }
  });

  it("checks the person as stored now before every write that can make a product buyable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const author = { ...user, role: 30 };
    // Admin when the publish starts, an Author by the time the product would go on sale.
    const publish = runtime({ sells: "item-1" });
    const asPublished = [user, author];
    const out = await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", publish), currentUser: async () => asPublished.shift() ?? author },
      async () => new Response(null, { status: 200 }));
    expect(out.status).toBe(200);
    expect(publish.calls).toEqual([]);
    // Disabled or deleted (no stored person) before an unpublish: refused, nothing changes.
    const unpublish = runtime({ sells: "item-1" });
    const cms = vi.fn(async () => new Response(null, { status: 200 }));
    const refused = await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/unpublish", unpublish), currentUser: async () => null }, cms);
    expect(refused.status).toBe(403);
    expect(cms).not.toHaveBeenCalled();
    expect(unpublish.calls).toEqual([]);
    // Lost after the first off-sale write and a failed page change: the product is not put back on sale.
    const undo = runtime({ sells: "item-1" });
    const asUndone = [user, user];
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/unpublish", undo), currentUser: async () => asUndone.shift() ?? null },
      async () => new Response(null, { status: 409 }));
    expect(undo.calls.map((call) => call.body)).toEqual([{ entryId: "01PAGE", onSale: false }]);
    // Lost right after the on-sale write while the page was unpublished: taking it off sale again still runs.
    const corrective = runtime({ sells: "item-1" });
    corrective.handleContentGet.mockImplementationOnce(corrective.handleContentGet.getMockImplementation()!)
      .mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "draft", data: { sells: "item-1" } } } }) as never);
    const asCorrected = [user, user];
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", corrective), currentUser: async () => asCorrected.shift() ?? null },
      async () => new Response(null, { status: 200 }));
    expect(corrective.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true },
      { entryId: "01PAGE", onSale: false },
    ]);
    // Every write that does run carries the person as stored at that moment.
    const fresh = { ...user, name: "Stored now" };
    const carried = runtime({ sells: "item-1" });
    await withProductOnSale({ ...input("POST", "/_emdash/api/content/products/01PAGE/publish", carried), currentUser: async () => fresh }, async () => new Response(null, { status: 200 }));
    expect(carried.calls.map((call) => call.user)).toEqual([fresh]);
    warn.mockRestore();
  });

  it("takes the product off sale again when the page was linked to another product while it was being put on sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const relinked = runtime({ sells: "item-1" });
    relinked.handleContentGet.mockImplementationOnce(relinked.handleContentGet.getMockImplementation()!)
      .mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", status: "published", data: { sells: "item-2" } } } }) as never);
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", relinked), async () => new Response(null, { status: 200 }));
    expect(relinked.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: true },
      { entryId: "01PAGE", onSale: false },
    ]);
    warn.mockRestore();
  });

  it("leaves every other request alone", async () => {
    const rt = runtime({ sells: "item-1" });
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    await withProductOnSale(input("GET", "/products/hat", rt), next);
    expect(next).toHaveBeenCalledOnce();
    expect(rt.handleContentGet).not.toHaveBeenCalled();
  });
});

// template-no-commerce-box-20261029: Commerce holds which product a page sells, so the store sends the page alone.
describe("a page whose product Commerce holds", () => {
  const author = { ...user, id: "u2", role: 30 };
  // A Commerce with the catalog route: `links` is each page's product as Commerce answers it ("down" fails the read).
  function linked(links: Record<string, string | null | "down">, fields: Record<string, unknown> = {}, slug?: string) {
    const rt = runtime(fields);
    rt.ownCatalog = true;
    const lookups: Array<{ body: unknown; user: unknown }> = [];
    rt.getPluginRouteMeta.mockImplementation((_pluginId: string, path: string) =>
      path === "catalog-items/set-on-sale" || path === "catalog" ? { public: false, permission: "content:publish_any" } : null);
    if (slug) rt.handleContentGet.mockImplementation(async () => ({ success: true, data: { item: { id: "01PAGE", slug, status: "published", data: fields } } }) as never);
    rt.commerce.mockImplementation(async (pluginId: string, _method: string, path: string, request: Request, caller: unknown) => {
      const body = await request.json() as { op?: string; entryId: string };
      if (path !== "catalog") {
        rt.calls.push({ pluginId, path, body, user: caller });
        return { success: true, data: { changed: true } };
      }
      lookups.push({ body, user: caller });
      const product = links[body.entryId];
      if (product === "down") return { success: false, error: { code: "INTERNAL_ERROR", message: "down" } } as never;
      return { success: true, data: { product: product ? { catalogItemId: product, name: "Hat" } : null } } as never;
    });
    return Object.assign(rt, { lookups });
  }
  const done = async () => new Response("{}", { status: 200 });

  it("asks Commerce for the page's product as the person publishing, and sends set-on-sale the page alone", async () => {
    const rt = linked({ "01PAGE": "item-1" });
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), done)).status).toBe(200);
    expect(rt.lookups[0]).toEqual({ body: { op: "get", entryId: "01PAGE" }, user });
    expect(rt.calls).toEqual([{ pluginId: "r_commerce", path: "catalog-items/set-on-sale", body: { entryId: "01PAGE", onSale: true }, user }]);
  });

  it("takes a linked page's product off sale before and after unpublish, naming only the page", async () => {
    const rt = linked({ "01PAGE": "item-1" });
    await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), done);
    await withProductOnSale(input("DELETE", "/_emdash/api/content/products/01PAGE", rt), done);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: false },
      { entryId: "01PAGE", onSale: false },
    ]);
  });

  it("refuses to publish a page that sells nothing, naming the Dinkus Commerce panel, and lets it unpublish", async () => {
    const rt = linked({ "01PAGE": null });
    const cms = vi.fn(done);
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), cms);
    expect(out.status).toBe(422);
    const { error } = await out.json();
    expect(error.code).toBe("PUBLISH_REJECTED");
    expect(error.message).toContain("Dinkus Commerce panel");
    expect(cms).not.toHaveBeenCalled();
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), cms)).status).toBe(200);
    expect(rt.calls).toEqual([]);
    // An Author's publish is refused the same way, before any permission matters.
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt, author), cms)).status).toBe(422);
  });

  it("never runs an unpublish blind when Commerce cannot say what the page sells, and keeps the publish", async () => {
    const rt = linked({ "01PAGE": "down" });
    const cms = vi.fn(done);
    const out = await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/unpublish", rt), cms);
    expect(out.status).toBe(503);
    expect((await out.json()).error.code).toBe("COMMERCE_UNAVAILABLE");
    expect(cms).not.toHaveBeenCalled();
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), cms)).status).toBe(200);
    expect(rt.calls).toEqual([]);
  });

  it("sells the seed's demonstration pages by their slug", async () => {
    const rt = linked({ "01PAGE": null }, {}, "everyday-tee");
    expect((await withProductOnSale(input("POST", "/_emdash/api/content/products/01PAGE/publish", rt), done)).status).toBe(200);
    expect(rt.calls.map((call) => call.body)).toEqual([{ catalogItemId: "dinkus-template-managed-product", entryId: "01PAGE", onSale: true }]);
  });
});
