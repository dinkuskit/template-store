import { describe, expect, it, vi } from "vitest";

import { productPageChange, scheduledSaleSweeper, sellScheduledPages, withProductOnSale } from "../../src/features/product-on-sale/index.js";

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
    put(id: string, value: Record<string, unknown>) {
      this.rows.set(id, { value, revision: `${id}-${this.rows.size}-${Math.random()}` });
    }
    async query() {
      return { items: [...this.rows.keys()].map((id) => ({ id })) };
    }
    async getVersioned(id: string) {
      return this.rows.get(id) ?? null;
    }
    async compareAndDelete(id: string, revision: string) {
      const applied = this.rows.get(id)?.revision === revision;
      if (applied) this.rows.delete(id);
      return { applied };
    }
  }

  type Page = { status: string; scheduledAt?: string | null; item?: string };
  function site(pages: Record<string, Page>, result: unknown = { success: true, data: { changed: true } }) {
    const rt = runtime({ commerce_item_id: "item-1" }, result as never);
    rt.handleContentGet.mockImplementation(async (_collection: string, id: string) => {
      const page = pages[id];
      return page
        ? { success: true, data: { item: { id, slug: id, status: page.status, scheduledAt: page.scheduledAt ?? null, data: { commerce_item_id: page.item ?? `item-${id}` } } } }
        : { success: false, error: { code: "NOT_FOUND", message: "not found" } };
    });
    return rt;
  }
  const sale = (id: string, by = "u1", recordedAt = "2026-10-25T11:59:00.000Z", role = 50) => ({ entryId: id, itemId: `item-${id}`, scheduledAt: "2026-10-25T11:59:30.000Z", by, role, recordedAt });
  const sweep = (rt: ReturnType<typeof runtime>, pending: Pending, extra: Record<string, unknown> = {}) =>
    sellScheduledPages({ url: new URL("https://shop.example.test/_emdash/admin"), runtime: rt, user, commercePluginId: "r_commerce", pendingSales: pending, userById: async (id: string) => people[id] ?? null, ...extra }, now);

  it("puts a page an admin scheduled on sale once EmDash has published it, as the visiting admin", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const rt = site({ hat: { status: "published" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([{ pluginId: "r_commerce", path: "catalog-items/set-on-sale", body: { catalogItemId: "item-hat", entryId: "hat", onSale: true }, user }]);
    expect(pending.rows.size).toBe(0);
  });

  it("leaves a page that is still scheduled, and keeps its record", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    pending.put("cap", sale("cap"));
    // Scheduled for later, and a published page scheduled to republish its draft.
    const rt = site({ hat: { status: "scheduled", scheduledAt: "2026-10-26T00:00:00.000Z" }, cap: { status: "published", scheduledAt: "2026-10-26T00:00:00.000Z" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    expect(pending.rows.size).toBe(2);
  });

  it("drops an Author's schedule, or one by someone who has since lost the permission: the product stays a Draft", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat", "u2"));
    pending.put("cap", sale("cap", "gone"));
    // Scheduled while an Author, an admin now.
    pending.put("tee", sale("tee", "u1", "2026-10-25T11:59:00.000Z", 30));
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

  it("drops records whose page is gone or sells another product, and stale ones for pages that never went live", async () => {
    const pending = new Pending();
    pending.put("gone", sale("gone"));
    pending.put("relinked", sale("relinked"));
    pending.put("old", sale("old", "u1", "2026-10-25T11:00:00.000Z"));
    pending.put("fresh", sale("fresh"));
    const rt = site({ relinked: { status: "published", item: "item-other" }, old: { status: "draft" }, fresh: { status: "draft" } });
    await sweep(rt, pending);
    expect(rt.calls).toEqual([]);
    // A draft recorded a minute ago may be a schedule EmDash is still storing.
    expect([...pending.rows.keys()]).toEqual(["fresh"]);
  });

  it("keeps the record to retry when Commerce refuses, and a schedule made meanwhile survives the sale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const refused = site({ hat: { status: "published" } }, { success: false, error: { code: "INTERNAL_ERROR", message: "boom" } });
    await sweep(refused, pending);
    expect(pending.rows.size).toBe(1);
    const rt = site({ hat: { status: "published" } });
    rt.handlePluginApiRoute.mockImplementationOnce(async () => {
      pending.put("hat", sale("hat"));
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(pending.rows.size).toBe(1);
    warn.mockRestore();
  });

  it("takes the product off sale again when the page is unpublished while it goes on sale", async () => {
    const pending = new Pending();
    pending.put("hat", sale("hat"));
    const pages: Record<string, Page> = { hat: { status: "published" } };
    const rt = site(pages);
    rt.handlePluginApiRoute.mockImplementation(async (pluginId: string, _m: string, path: string, request: Request, caller: unknown) => {
      rt.calls.push({ pluginId, path, body: await request.json(), user: caller });
      pages.hat = { status: "draft" };
      return { success: true, data: { changed: true } };
    });
    await sweep(rt, pending);
    expect(rt.calls.map((call) => call.body)).toEqual([
      { catalogItemId: "item-hat", entryId: "hat", onSale: true },
      { catalogItemId: "item-hat", entryId: "hat", onSale: false },
    ]);
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
