import { describe, expect, it } from "vitest";

import { createPlugin } from "../../src/features/product-url-plugin/index.js";

type Claim = { entryId: string; itemId: string; path: string };

class Claims {
  rows = new Map<string, Claim>();

  async put(id: string, data: Claim): Promise<void> {
    const conflict = [...this.rows.values()].find((row) => row.itemId === data.itemId && row.entryId !== id);
    if (conflict) throw new Error("unique itemId");
    this.rows.set(id, data);
  }

  async query(): Promise<{ items: Array<{ id: string; data: Claim }> }> {
    return { items: [...this.rows].map(([id, data]) => ({ id, data })) };
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}

function context(claims: Claims) {
  return { storage: { claims } } as never;
}

function event(id: string, itemId: string, slug = id) {
  return {
    collection: "products",
    content: { id, slug, commerce_item_id: itemId },
    origin: { source: "api" as const },
  };
}

describe("product URL publish claims", () => {
  it("rejects sequential duplicate publishes while the first page remains claimed", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const handler = plugin.hooks["content:beforePublish"]!.handler;

    await expect(handler(event("one", "item-1", "first"), context(claims))).resolves.toBeUndefined();
    await expect(handler(event("two", "item-1", "second"), context(claims))).resolves.toMatchObject({
      cancel: true,
      reason: "Commerce product is already published at /products/first.",
    });
    expect(claims.rows.get("one")?.path).toBe("/products/first");
  });

  it("serializes simultaneous publishes through the unique item claim", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const handler = plugin.hooks["content:beforePublish"]!.handler;
    const results = await Promise.all([
      handler(event("one", "item-1"), context(claims)),
      handler(event("two", "item-1"), context(claims)),
    ]);

    expect(results.filter((result) => result?.cancel)).toHaveLength(1);
    expect(claims.rows.size).toBe(1);
  });

  it("releases only the holder on unpublish and supports republish", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const publish = plugin.hooks["content:beforePublish"]!.handler;
    const unpublish = plugin.hooks["content:afterUnpublish"]!.handler;

    await publish(event("one", "item-1"), context(claims));
    await unpublish({ content: { id: "one" }, collection: "products" }, context(claims));
    await expect(publish(event("two", "item-1"), context(claims))).resolves.toBeUndefined();
  });

  it("updates a published entry claim when its itemId changes", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const publish = plugin.hooks["content:beforePublish"]!.handler;

    await publish(event("one", "item-1"), context(claims));
    await publish(event("one", "item-2"), context(claims));
    await expect(publish(event("two", "item-1"), context(claims))).resolves.toBeUndefined();
    expect(claims.rows.get("one")?.itemId).toBe("item-2");
  });

  it("applies the same claim policy to scheduled publishes", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const schedule = plugin.hooks["content:beforeSchedule"]!.handler;

    await expect(schedule({ ...event("one", "item-1"), scheduledAt: "2030-01-01T00:00:00Z" }, context(claims))).resolves.toBeUndefined();
    await expect(schedule({ ...event("two", "item-1"), scheduledAt: "2030-01-02T00:00:00Z" }, context(claims))).resolves.toMatchObject({
      cancel: true,
    });
  });
});
