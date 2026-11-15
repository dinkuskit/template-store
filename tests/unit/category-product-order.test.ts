import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderCategoryProducts } from "../../src/features/store-shell/category-product-order.js";
import { buildMerchCollections, type MerchCollection } from "../../src/features/store-shell/merch-catalog.js";

const { readReferences } = vi.hoisted(() => ({ readReferences: vi.fn() }));
vi.mock("emdash", () => ({ getEmDashReferences: readReferences }));

const page = (ids: string[], nextCursor?: string) => ({ entries: ids.map((id) => ({ id })), nextCursor });
const categories = () => buildMerchCollections([
  { id: "ribbed-beanie", data: { title: "Ribbed Beanie", categories: ["hats"] } },
  { id: "canvas-cap", data: { title: "Canvas Cap", categories: ["hats"] } },
  { id: "everyday-tee", data: { title: "Everyday Tee", categories: ["hats", "tees"] } },
], [
  { id: "hats", data: { title: "Hats" } },
  { id: "tees", data: { title: "Tees" } },
]);
const hats = () => categories()[0]!;
const ids = (category: MerchCollection) => category.items.map((item) => item.id);

beforeEach(() => { readReferences.mockReset(); });

describe("published category product order", () => {
  it("does not read references when there is nothing to reorder", async () => {
    const category = hats();
    for (const items of [[], [category.items[0]!]]) {
      const trivial = { ...category, items };
      expect(await orderCategoryProducts(trivial)).toBe(trivial);
    }
    expect(readReferences).not.toHaveBeenCalled();
  });

  it("uses the category's ordered product references, not the global product iteration order", async () => {
    const [category, tees] = categories();
    const original = structuredClone(category!);
    readReferences.mockResolvedValue(page(["everyday-tee", "canvas-cap", "ribbed-beanie"]));
    const result = await orderCategoryProducts(category!);
    expect(ids(result)).toEqual(["everyday-tee", "canvas-cap", "ribbed-beanie"]);
    expect(readReferences).toHaveBeenCalledWith("categories", "hats", "products", { limit: 100 });
    expect(category).toEqual(original);
    expect(ids(tees!)).toEqual(["everyday-tee"]);
    for (const item of result.items) expect(item).toBe(category!.items.find((candidate) => candidate.id === item.id));
  });

  it("walks reference pages even when an earlier page has no visible entries", async () => {
    readReferences.mockResolvedValueOnce(page(["everyday-tee"], "second"))
      .mockResolvedValueOnce(page([], "third"))
      .mockResolvedValueOnce(page(["canvas-cap", "ribbed-beanie"]));
    expect(ids(await orderCategoryProducts(hats()))).toEqual(["everyday-tee", "canvas-cap", "ribbed-beanie"]);
    expect(readReferences.mock.calls.map((call) => call[3])).toEqual([
      { limit: 100 }, { limit: 100, cursor: "second" }, { limit: 100, cursor: "third" },
    ]);
  });

  it("does not truncate categories larger than a reference page", async () => {
    const category = hats();
    const items = Array.from({ length: 125 }, (_, i) => ({ ...category.items[0]!, id: `product-${i}` }));
    const ordered = items.map((item) => item.id).reverse();
    readReferences.mockResolvedValueOnce(page(ordered.slice(0, 100), "more"))
      .mockResolvedValueOnce(page(ordered.slice(100)));
    expect(ids(await orderCategoryProducts({ ...category, items }))).toEqual(ordered);
  });

  it("never admits unavailable/draft/removed products and leaves unmatched items stably last", async () => {
    const category = hats();
    readReferences.mockResolvedValue(page(["draft-or-removed-product", "everyday-tee", "everyday-tee", "missing-product"]));
    const result = await orderCategoryProducts(category);
    expect(ids(result)).toEqual(["everyday-tee", "ribbed-beanie", "canvas-cap"]);
    expect(result.items).toHaveLength(category.items.length);
  });

  it("retains the previous order when the reference field is absent or empty", async () => {
    const category = hats();
    readReferences.mockResolvedValue(page([]));
    expect(await orderCategoryProducts(category)).toBe(category);
  });

  it("does not apply a misleading partial order after a later page fails", async () => {
    const category = hats();
    readReferences.mockResolvedValueOnce(page(["everyday-tee"], "more"))
      .mockResolvedValueOnce({ entries: [], error: new Error("temporary CMS failure") });
    expect(await orderCategoryProducts(category)).toBe(category);
  });

  it("retains the previous order on a thrown read error", async () => {
    const category = hats();
    readReferences.mockRejectedValue(new Error("temporary CMS failure"));
    expect(await orderCategoryProducts(category)).toBe(category);
  });

  it("stops a broken repeated cursor without applying a partial order", async () => {
    const category = hats();
    readReferences.mockResolvedValue(page(["everyday-tee"], "same"));
    expect(await orderCategoryProducts(category)).toBe(category);
    expect(readReferences).toHaveBeenCalledTimes(2);
  });
});
