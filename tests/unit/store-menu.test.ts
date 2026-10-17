import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_MENU_NAME, isCurrentMenuItem } from "../../src/features/store-shell/store-menu.js";

describe("store main menu", () => {
  it("marks only same-path links current", () => {
    expect(isCurrentMenuItem({ url: "/" }, "/")).toBe(true);
    expect(isCurrentMenuItem({ url: "/categories/hats" }, "/categories/hats/")).toBe(true);
    expect(isCurrentMenuItem({ url: "/categories/hats/" }, "/categories/hats")).toBe(true);
    expect(isCurrentMenuItem({ url: "/" }, "/categories/hats")).toBe(false);
    expect(isCurrentMenuItem({ url: "/#commerce-catalog" }, "/")).toBe(false);
    expect(isCurrentMenuItem({ url: "/cart?x=1" }, "/cart")).toBe(false);
    expect(isCurrentMenuItem({ url: "https://example.com/" }, "/")).toBe(false);
    expect(isCurrentMenuItem({ url: "//example.com/" }, "/")).toBe(false);
  });

  it("seeds a Home and Shop menu whose Shop links reach every seeded category", () => {
    const seed = JSON.parse(readFileSync(resolve("seed/seed.json"), "utf8"));
    const menu = seed.menus.find((entry: { name: string }) => entry.name === MAIN_MENU_NAME);
    expect(menu?.items.map((item: { label: string }) => item.label)).toEqual(["Home", "Shop"]);
    const shop = menu.items[1];
    expect(shop.url).toBe("/#commerce-catalog");
    const categoryRefs = shop.children
      .filter((child: { type: string }) => child.type === "collection")
      .map((child: { collection: string; ref: string }) => `${child.collection}:${child.ref}`);
    const seededCategories = seed.content.categories.map((entry: { slug: string }) => `categories:${entry.slug}`);
    expect(categoryRefs.toSorted()).toEqual(seededCategories.toSorted());
  });
});
