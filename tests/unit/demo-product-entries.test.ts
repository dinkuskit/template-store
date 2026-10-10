import { describe, expect, it } from "vitest";

import { buildDemoProductEntries } from "../../scripts/demo-product-entries.js";

const links = [
  { sku: "DEMO-HOSTED-SHIRT", catalogItemId: "commerce-shirt" },
  { sku: "DEMO-HOSTED-CAP", catalogItemId: "commerce-cap" },
  { sku: "DEMO-HOSTED-MUG", catalogItemId: "commerce-mug" },
  { sku: "DEMO-HOSTED-HOODIE-S", catalogItemId: "commerce-hoodie" },
  { sku: "DEMO-HOSTED-TOTE", catalogItemId: "commerce-tote" },
  { sku: "DEMO-HOSTED-THROW", catalogItemId: "commerce-throw" },
  { sku: "DEMO-HOSTED-TRAY", catalogItemId: "commerce-tray" },
  { sku: "DEMO-HOSTED-SOCKS", catalogItemId: "commerce-socks" },
  { sku: "DEMO-HOSTED-BOTTLE", catalogItemId: "commerce-bottle" },
];

describe("demo EmDash product entries", () => {
  it("creates published entries linked to the matching Commerce item", () => {
    const entries = buildDemoProductEntries("native-development", links);

    expect(entries).toHaveLength(9);
    expect(entries.every((entry) => entry.status === "published")).toBe(true);
    expect(entries.find((entry) => entry.id === "demo-hosted-cap")?.data).toMatchObject({
      commerce_item_id: "commerce-cap",
      categories: ["hats"],
      visual_label: "CAP",
    });
  });

  it("does not overwrite existing entries because the seed uses conflict skipping", () => {
    const entries = buildDemoProductEntries("demo", links);

    expect(entries.map((entry) => entry.slug)).toEqual([
      "demo-hosted-shirt",
      "demo-hosted-cap",
      "demo-hosted-mug",
      "demo-hosted-hoodie-s",
      "demo-hosted-tote",
      "demo-hosted-throw",
      "demo-hosted-tray",
      "demo-hosted-socks",
      "demo-hosted-bottle",
    ]);
  });

  it("creates nothing outside the demo catalog profiles", () => {
    expect(buildDemoProductEntries("shipping", links)).toEqual([]);
    expect(buildDemoProductEntries(undefined, links)).toEqual([]);
  });
});
