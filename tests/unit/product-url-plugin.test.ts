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

class Pending {
  rows = new Map<string, { value: Record<string, unknown>; revision: string }>();
  private next = 0;

  async getVersioned(id: string) {
    return this.rows.get(id) ?? null;
  }

  async compareAndSet(id: string, expected: string | null, value: Record<string, unknown>) {
    if ((this.rows.get(id)?.revision ?? null) !== expected) return { applied: false };
    this.rows.set(id, { value, revision: `r${(this.next += 1)}` });
    return { applied: true };
  }

  async compareAndDelete(id: string, expected: string) {
    if (this.rows.get(id)?.revision !== expected) return { applied: false };
    this.rows.delete(id);
    return { applied: true };
  }

  async delete(id: string) {
    return this.rows.delete(id);
  }

  value(id: string) {
    return this.rows.get(id)?.value;
  }
}

function context(claims: Claims, pending = new Pending()) {
  return { storage: { claims, pending_sales: pending } } as never;
}

function event(id: string, itemId: string, slug = id) {
  return {
    collection: "products",
    // The shape EmDash 1.2.0 passes: fields live under `data`.
    content: { id, slug, status: "draft", data: { title: id, commerce_item_id: itemId } },
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

  it("cancels a publish whose content carries no Commerce product ID", async () => {
    const plugin = createPlugin();
    const handler = plugin.hooks["content:beforePublish"]!.handler;
    const content = { id: "one", slug: "one", status: "draft", data: { title: "One" } };
    await expect(
      handler({ collection: "products", content, origin: { source: "api" as const } }, context(new Claims())),
    ).resolves.toMatchObject({ cancel: true });
  });
});

describe("schedules recorded for the store's admin-visit sale", () => {
  const at = "2030-01-01T00:00:00Z";
  const admin = { id: "admin", role: 50 };
  const scheduled = (id: string, itemId: string, actor?: { id: string; role: number }, scheduledAt = at) => ({
    ...event(id, itemId),
    scheduledAt,
    ...(actor ? { actor: { ...actor, source: "api" as const } } : {}),
  });
  // What EmDash hands content:afterSchedule once the schedule is stored.
  const stored = (id: string, itemId: string, scheduledAt: string = at) => ({
    collection: "products",
    content: { id, slug: id, status: "scheduled", scheduledAt: scheduledAt.replace("Z", ".000Z"), data: { commerce_item_id: itemId } },
  });
  const run = (plugin: ReturnType<typeof createPlugin>, hook: string, payload: unknown, claims: Claims, pending: Pending) =>
    (plugin.hooks as Record<string, { handler: (event: never, ctx: never) => Promise<unknown> }>)[hook]!.handler(payload as never, context(claims, pending));

  it("proposes the schedule first and grants it only once EmDash has stored it", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
    expect(pending.value("one")).toMatchObject({ proposals: [{ by: "admin", role: 50, itemId: "item-1", scheduledAt: at }], confirmed: null, state: "scheduled" });
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    expect(pending.value("one")).toMatchObject({ proposals: [], confirmed: { by: "admin", role: 50, itemId: "item-1" }, state: "scheduled" });
  });

  it("grants nothing for a schedule that failed, came from no person, or does not match what EmDash stored", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    // An Author's schedule is stored; an admin's later attempt fails, so EmDash never confirms it.
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", { id: "author", role: 30 }), claims, pending);
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin, "2030-02-01T00:00:00Z"), claims, pending);
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "author", role: 30 } });
    // A schedule from no person.
    await run(plugin, "content:beforeSchedule", scheduled("two", "item-2"), claims, pending);
    await run(plugin, "content:afterSchedule", stored("two", "item-2"), claims, pending);
    expect(pending.value("two")).toMatchObject({ confirmed: null });
    // EmDash stored another time than the one proposed.
    await run(plugin, "content:beforeSchedule", scheduled("three", "item-3", admin), claims, pending);
    await run(plugin, "content:afterSchedule", stored("three", "item-3", "2031-01-01T00:00:00Z"), claims, pending);
    expect(pending.value("three")).toMatchObject({ confirmed: null });
  });

  it("never lends one request's authority to another's stored schedule", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    // An Author and an admin schedule the same page for the same time at once; the Author's is stored first.
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", { id: "author", role: 30 }), claims, pending);
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "author", role: 30 }, proposals: [] });
    // The admin's own schedule then stored finds nothing proposed: it grants nothing rather than guess.
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    expect(pending.value("one")).toMatchObject({ confirmed: null });
    // A schedule from no person at the same time as an admin's grants nothing.
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1"), claims, pending);
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    expect(pending.value("one")).toMatchObject({ confirmed: null });
  });

  it("records nothing for a schedule the claim refuses", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
    await run(plugin, "content:beforeSchedule", scheduled("two", "item-1", admin), claims, pending);
    expect([...pending.rows.keys()]).toEqual(["one"]);
  });

  it("marks a granted schedule published only through EmDash's own scheduled publish", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
    await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
    await run(plugin, "content:beforePublish", { ...event("one", "item-1"), origin: { source: "scheduler" } }, claims, pending);
    expect(pending.value("one")).toMatchObject({ state: "publishing" });
    await run(plugin, "content:afterPublish", { collection: "products", content: { id: "one" } }, claims, pending);
    expect(pending.value("one")).toMatchObject({ state: "published", confirmed: { by: "admin" } });
    // A scheduled publish without a grant leaves no record.
    await run(plugin, "content:beforeSchedule", scheduled("two", "item-2", admin), claims, pending);
    await run(plugin, "content:beforePublish", { ...event("two", "item-2"), origin: { source: "scheduler" } }, claims, pending);
    expect(pending.rows.has("two")).toBe(false);
  });

  it("drops the record on a person's own publish, an unschedule, unpublish or trash", async () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    const grant = async () => {
      await run(plugin, "content:beforeSchedule", scheduled("one", "item-1", admin), claims, pending);
      await run(plugin, "content:afterSchedule", stored("one", "item-1"), claims, pending);
      expect(pending.rows.has("one")).toBe(true);
    };
    await grant();
    await run(plugin, "content:beforePublish", event("one", "item-1"), claims, pending);
    expect(pending.rows.has("one")).toBe(false);
    // afterPublish of that publish changes nothing.
    await run(plugin, "content:afterPublish", { collection: "products", content: { id: "one" } }, claims, pending);
    expect(pending.rows.has("one")).toBe(false);
    for (const [hook, payload] of [
      ["content:afterUnschedule", { content: { id: "one" }, collection: "products" }],
      ["content:afterUnpublish", { content: { id: "one" }, collection: "products" }],
      ["content:afterDelete", { id: "one", collection: "products" }],
    ] as const) {
      await grant();
      await run(plugin, hook, payload, claims, pending);
      expect(pending.rows.has("one")).toBe(false);
    }
  });
});
