import { describe, expect, it, vi } from "vitest";

import { productPageChange, withProductOnSale, type OnSaleRuntime } from "../../src/features/product-on-sale/index.js";

const owner = { id: "owner", email: "owner@example.test", name: null, role: 50, createdAt: "2026-10-23T00:00:00.000Z" };

function store() {
  const state = { product: "item-1" as string | null, status: "published", offSale: false };
  const writes: Array<{ body: Record<string, unknown>; caller: unknown }> = [];
  const order: string[] = [];
  const runtime: OnSaleRuntime = {
    getPluginRouteMeta: () => ({ permission: "content:publish_any" }),
    handleContentGet: vi.fn(async () => state.status === "trashed"
      ? { success: false, error: { code: "NOT_FOUND" } }
      : { success: true, data: { item: { id: "page-1", status: state.status, data: { title: "Notebook" } } } }),
    handlePluginApiRoute: vi.fn(async (_pluginId, _method, path, request, caller) => {
      const body = await request.json() as Record<string, unknown>;
      if (path === "catalog") return { success: true, data: { product: state.product ? { catalogItemId: state.product } : null } };
      writes.push({ body, caller });
      order.push("commerce");
      state.offSale = body.onSale === false;
      if (body.deleted === true) state.product = null;
      return { success: true, data: { changed: true } };
    }),
  };
  function input(method: string, suffix = "", user: unknown = owner) {
    const url = new URL(`https://shop.example.test/_emdash/api/content/products/page-1${suffix}`);
    return { request: new Request(url, { method }), url, runtime, user, commercePluginId: "r_commerce" };
  }
  return { state, writes, order, runtime, input };
}
const ok = async () => new Response("{}", { status: 200 });

describe("product page Trash and irreversible deletion", () => {
  it("restores the same Commerce-held product without a CMS backup field", async () => {
    const s = store();
    await withProductOnSale(s.input("DELETE"), async () => {
      s.state.status = "trashed";
      return ok();
    });
    expect(s.state.offSale).toBe(true);
    // EmDash restores the same entry as a draft; restoration itself grants no sale.
    s.state.status = "draft";
    expect(s.state.offSale).toBe(true);
    const response = await withProductOnSale(s.input("POST", "/publish"), async () => {
      s.state.status = "published";
      return new Response(JSON.stringify({ data: { item: { data: { title: "Notebook" } } } }));
    });
    expect(response.status).toBe(200);
    expect(s.state.product).toBe("item-1");
    expect(s.state.offSale).toBe(false);
    expect(s.writes.map(({ body }) => body)).toEqual([
      { entryId: "page-1", onSale: false },
      { entryId: "page-1", onSale: false },
      { entryId: "page-1", onSale: true, name: "Notebook" },
    ]);
  });

  it("recognizes irreversible deletion only on the exact DELETE endpoint", () => {
    const path = "/_emdash/api/content/products/page-1/permanent";
    expect(productPageChange("DELETE", path)).toEqual({ entryId: "page-1", action: "permanent" });
    expect(productPageChange("POST", path)).toBeNull();
    expect(productPageChange("DELETE", path + "/extra")).toBeNull();
    expect(productPageChange("DELETE", path.replace("products", "pages"))).toBeNull();
    expect(productPageChange("DELETE", path.replace("permanent", "publish"))).toBeNull();
  });

  it("releases the link only after successful permanent deletion, without trying to read a gone page", async () => {
    const s = store();
    s.state.status = "trashed";
    s.state.offSale = true;
    const fresh = { ...owner, name: "Fresh owner" };
    await withProductOnSale({ ...s.input("DELETE", "/permanent"), currentUser: async () => fresh }, async () => {
      s.order.push("cms");
      return ok();
    });
    expect(s.order).toEqual(["cms", "commerce"]);
    expect(s.runtime.handleContentGet).not.toHaveBeenCalled();
    expect(s.writes).toEqual([{ body: { entryId: "page-1", onSale: false, deleted: true }, caller: fresh }]);
    expect(s.state).toMatchObject({ product: null, offSale: true });
  });

  it("uses the CMS-confirmed entry ID when permanent deletion was requested by slug", async () => {
    const s = store();
    const url = new URL("https://shop.example.test/_emdash/api/content/products/notebook/permanent");
    const input = { ...s.input("DELETE", "/permanent"), url, request: new Request(url, { method: "DELETE" }) };
    await withProductOnSale(input, async () => new Response(JSON.stringify({ data: { deleted: true, id: "page-1" } })));
    expect(s.writes.map(({ body }) => body)).toEqual([{ entryId: "page-1", onSale: false, deleted: true }]);
  });

  it.each([403, 409, 500])("keeps the binding when permanent deletion is refused (%s)", async (status) => {
    const s = store();
    const response = await withProductOnSale(s.input("DELETE", "/permanent"), async () => new Response(null, { status }));
    expect(response.status).toBe(status);
    expect(s.writes).toEqual([]);
    expect(s.state.product).toBe("item-1");
  });

  it("does not release a link after a thrown CMS deletion", async () => {
    const s = store();
    await expect(withProductOnSale(s.input("DELETE", "/permanent"), async () => { throw new Error("CMS unavailable"); })).rejects.toThrow("CMS unavailable");
    expect(s.writes).toEqual([]);
  });

  it("does not gain Commerce authority through permanent deletion", async () => {
    for (const current of [null, { ...owner, role: 30 }]) {
      const s = store();
      await withProductOnSale({ ...s.input("DELETE", "/permanent"), currentUser: async () => current }, ok);
      expect(s.writes).toEqual([]);
    }
    const anonymous = store();
    await withProductOnSale(anonymous.input("DELETE", "/permanent", null), ok);
    expect(anonymous.writes).toEqual([]);
    const older = store();
    older.runtime.getPluginRouteMeta = () => null;
    await withProductOnSale(older.input("DELETE", "/permanent"), ok);
    expect(older.writes).toEqual([]);
  });

  it("keeps the successful CMS answer when best-effort Commerce cleanup is unavailable", async () => {
    const s = store();
    s.runtime.handlePluginApiRoute = async () => { throw new Error("Commerce unavailable"); };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await withProductOnSale(s.input("DELETE", "/permanent"), ok);
      expect(response.status).toBe(200);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("link stays"), "Commerce unavailable");
    } finally {
      warning.mockRestore();
    }
  });
});
