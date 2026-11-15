import { beforeEach, describe, expect, it, vi } from "vitest";

const { readProduct } = vi.hoisted(() => ({ readProduct: vi.fn() }));
vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(async () => ({
    entries: [
      { id: "other-page", data: { id: "01OTHER" } },
      { id: "sized-tee", data: { id: "01TEEPAGE" } },
    ],
  })),
}));
vi.mock("../../src/features/commerce-catalog/installed.js", () => ({
  readInstalledCommerceProduct: readProduct,
}));

const { getVariant } = await import("../../src/features/guest-cart/variant-route.js");

function call(id: string, accept = "text/html") {
  const url = new URL(`https://shop.test/variants/${id}`);
  return getVariant({
    params: { id },
    url,
    request: new Request(url, { headers: { accept } }),
    locals: { emdash: {} },
  } as never) as Promise<Response>;
}

describe("the /variants/<id> link", () => {
  beforeEach(() => { readProduct.mockReset(); });

  it("sends a Commerce id to the page that sells it, at its published slug", async () => {
    readProduct.mockResolvedValue({ id: "prod_tee", page: "01TEEPAGE", variants: [{ id: "var_m" }, { id: "var_l" }] });
    const variant = await call("var_m");
    expect(variant.status).toBe(302);
    expect(variant.headers.get("location")).toBe("/products/sized-tee?variant=var_m");
    const product = await call("prod_tee", "application/json");
    expect(await product.json()).toEqual({ ok: true, url: "/products/sized-tee" });
  });

  it("answers 404 for an unknown item or an unpublished page, and 503 when Commerce cannot answer", async () => {
    readProduct.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
    readProduct.mockResolvedValue({ id: "prod_draft", page: "01DRAFT" });
    expect(await (await call("prod_draft", "application/json")).json()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    readProduct.mockRejectedValue(new Error("Commerce is down"));
    expect((await call("prod_tee")).status).toBe(503);
    expect((await call("..%2Fadmin")).status).toBe(404);
    expect(readProduct).toHaveBeenCalledTimes(3);
  });
});
