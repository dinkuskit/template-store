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

function context(claims: Claims, pending = new Pending(), schedules = new Map<string, string | null>()) {
  const content = {
    async get(collection: string, id: string) {
      if (collection !== "products") return null;
      if (schedules.get(id) === undefined) throw new Error("unreadable");
      return { id, scheduledAt: schedules.get(id) };
    },
  };
  return { storage: { claims, pending_sales: pending }, content } as never;
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

  // template-no-commerce-box-20261029: Commerce holds the link, and the store's publish check refuses a page with no
  // product, so a page with no Commerce product field publishes here and claims nothing.
  it("lets a page with no Commerce product field publish and schedule, and drops the claim it held", async () => {
    const plugin = createPlugin();
    const publish = plugin.hooks["content:beforePublish"]!.handler;
    const schedule = plugin.hooks["content:beforeSchedule"]!.handler;
    const claims = new Claims();
    await publish(event("one", "item-1"), context(claims));
    expect(claims.rows.get("one")?.itemId).toBe("item-1");
    const content = { id: "one", slug: "one", status: "draft", data: { title: "One" } };
    await expect(
      publish({ collection: "products", content, origin: { source: "api" as const } }, context(claims)),
    ).resolves.toBeUndefined();
    expect(claims.rows.has("one")).toBe(false);
    await expect(
      schedule({ collection: "products", content, origin: { source: "api" as const }, scheduledAt: "2030-01-01T00:00:00Z" }, context(claims)),
    ).resolves.toBeUndefined();
    expect(claims.rows.size).toBe(0);
    // The other page may now claim that value on an older store.
    await expect(publish(event("two", "item-1"), context(claims))).resolves.toBeUndefined();
  });

  it("still refuses a field value over 1,024 characters", async () => {
    const plugin = createPlugin();
    const publish = plugin.hooks["content:beforePublish"]!.handler;
    await expect(publish(event("one", "x".repeat(1025)), context(new Claims()))).resolves.toMatchObject({ cancel: true });
  });
});

describe("schedules recorded for the store's admin-visit sale", () => {
  const at = "2030-01-01T00:00:00Z";
  const admin = { id: "admin", role: 50 };
  const author = { id: "author", role: 30 };
  const scheduled = (id: string, itemId: string, actor?: { id: string; role: number }, scheduledAt = at) => ({
    ...event(id, itemId),
    scheduledAt,
    ...(actor ? { actor: { ...actor, source: "api" as const } } : {}),
  });
  // What EmDash hands content:afterSchedule once a schedule is stored; its copy of the time may be stale.
  const stored = (id: string, itemId: string, scheduledAt: string = at) => ({
    collection: "products",
    content: { id, slug: id, status: "scheduled", scheduledAt, data: { commerce_item_id: itemId } },
  });
  // The schedule each page holds now, as EmDash stores it (milliseconds included).
  const setup = () => {
    const plugin = createPlugin();
    const claims = new Claims();
    const pending = new Pending();
    const schedules = new Map<string, string | null>();
    const run = (hook: string, payload: unknown) =>
      (plugin.hooks as Record<string, { handler: (event: never, ctx: never) => Promise<unknown> }>)[hook]!.handler(payload as never, context(claims, pending, schedules));
    const holds = (id: string, scheduledAt: string | null) => schedules.set(id, scheduledAt?.replace("Z", ".000Z") ?? null);
    return { claims, pending, schedules, run, holds };
  };

  it("proposes the schedule first and grants it only once EmDash has stored it", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", "item-1", admin));
    expect(pending.value("one")).toMatchObject({ proposals: [{ by: "admin", role: 50, itemId: "item-1", scheduledAt: at }], confirmed: null, state: "scheduled" });
    holds("one", at);
    await run("content:afterSchedule", stored("one", "item-1"));
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "admin", role: 50, itemId: "item-1" }, state: "scheduled" });
  });

  it("grants nothing for a schedule that failed, came from no person, or does not match what EmDash holds", async () => {
    const { pending, run, holds } = setup();
    // An Author's schedule is stored; an admin's later attempt at another time fails, so the Author's stays granted.
    await run("content:beforeSchedule", scheduled("one", "item-1", author));
    holds("one", at);
    await run("content:afterSchedule", stored("one", "item-1"));
    await run("content:beforeSchedule", scheduled("one", "item-1", admin, "2030-02-01T00:00:00Z"));
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "author", role: 30 } });
    // A schedule from no person.
    await run("content:beforeSchedule", scheduled("two", "item-2"));
    holds("two", at);
    await run("content:afterSchedule", stored("two", "item-2"));
    expect(pending.value("two")).toMatchObject({ confirmed: null });
    // EmDash holds another time than the one proposed, or the page cannot be read, or is no longer scheduled.
    await run("content:beforeSchedule", scheduled("three", "item-3", admin));
    holds("three", "2031-01-01T00:00:00Z");
    await run("content:afterSchedule", stored("three", "item-3"));
    expect(pending.value("three")).toMatchObject({ confirmed: null });
    await run("content:beforeSchedule", scheduled("four", "item-4", admin));
    await run("content:afterSchedule", stored("four", "item-4"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
    holds("four", null);
    await run("content:afterSchedule", stored("four", "item-4"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
  });

  it("never lends one request's authority to another's stored schedule", async () => {
    const { pending, run, holds } = setup();
    // Author A and admin B propose the same time; B's confirmation runs; admin C proposes before A's confirmation.
    await run("content:beforeSchedule", scheduled("one", "item-1", author));
    await run("content:beforeSchedule", scheduled("one", "item-1", admin));
    holds("one", at);
    await run("content:afterSchedule", stored("one", "item-1"));
    expect(pending.value("one")).toMatchObject({ confirmed: null });
    await run("content:beforeSchedule", scheduled("one", "item-1", { id: "admin-c", role: 50 }));
    await run("content:afterSchedule", stored("one", "item-1"));
    expect(pending.value("one")).toMatchObject({ confirmed: null });
    // One admin's schedule is granted, then another person's proposal at that time withdraws the grant at once,
    // even if its confirmation never runs.
    await run("content:beforeSchedule", scheduled("two", "item-2", admin));
    holds("two", at);
    await run("content:afterSchedule", stored("two", "item-2"));
    expect(pending.value("two")).toMatchObject({ confirmed: { by: "admin" } });
    await run("content:beforeSchedule", scheduled("two", "item-2", author));
    expect(pending.value("two")).toMatchObject({ confirmed: null });
    // The same person lowered to Author between two schedules at the same time is granted only their lower role.
    await run("content:beforeSchedule", scheduled("three", "item-3", admin));
    holds("three", at);
    await run("content:afterSchedule", stored("three", "item-3"));
    await run("content:beforeSchedule", scheduled("three", "item-3", { id: "admin", role: 30 }));
    expect(pending.value("three")).toMatchObject({ confirmed: { by: "admin", role: 30 } });
    // A schedule from no person at the same time as an admin's grants nothing.
    await run("content:beforeSchedule", scheduled("four", "item-4", admin));
    await run("content:beforeSchedule", scheduled("four", "item-4"));
    holds("four", at);
    await run("content:afterSchedule", stored("four", "item-4"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
    // A late confirmation carrying an older time grants from what EmDash holds now, not from its own copy.
    await run("content:beforeSchedule", scheduled("five", "item-5", author));
    await run("content:beforeSchedule", scheduled("five", "item-5", admin, "2030-03-01T00:00:00Z"));
    holds("five", at);
    await run("content:afterSchedule", stored("five", "item-5", "2030-03-01T00:00:00Z"));
    expect(pending.value("five")).toMatchObject({ confirmed: { by: "author", role: 30 } });
  });

  it("grants nothing once more distinct schedules were asked for than are kept", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", "item-1", author));
    for (let minute = 1; minute < 50; minute += 1) {
      await run("content:beforeSchedule", scheduled("one", "item-1", admin, `2030-01-01T00:${String(minute).padStart(2, "0")}:00Z`));
    }
    // The same proposal again is kept once.
    await run("content:beforeSchedule", scheduled("one", "item-1", author));
    expect(pending.value("one")).toMatchObject({ overflowed: false });
    // One more distinct proposal: nothing is evicted, and nothing is granted until the record is removed.
    await run("content:beforeSchedule", scheduled("one", "item-1", admin, "2030-01-01T01:00:00Z"));
    holds("one", "2030-01-01T01:00:00Z");
    await run("content:afterSchedule", stored("one", "item-1", "2030-01-01T01:00:00Z"));
    expect(pending.value("one")).toMatchObject({ overflowed: true, confirmed: null });
    expect((pending.value("one")?.proposals as unknown[]).length).toBe(50);
  });

  it("records nothing for a schedule the claim refuses", async () => {
    const { pending, run } = setup();
    await run("content:beforeSchedule", scheduled("one", "item-1", admin));
    await run("content:beforeSchedule", scheduled("two", "item-1", admin));
    expect([...pending.rows.keys()]).toEqual(["one"]);
  });

  it("marks a granted schedule published only through EmDash's own scheduled publish", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", "item-1", admin));
    holds("one", at);
    await run("content:afterSchedule", stored("one", "item-1"));
    await run("content:beforePublish", { ...event("one", "item-1"), origin: { source: "scheduler" } });
    expect(pending.value("one")).toMatchObject({ state: "publishing" });
    await run("content:afterPublish", { collection: "products", content: { id: "one" } });
    expect(pending.value("one")).toMatchObject({ state: "published", confirmed: { by: "admin" } });
    // A scheduled publish without a grant leaves no record.
    await run("content:beforeSchedule", scheduled("two", "item-2", admin));
    await run("content:beforePublish", { ...event("two", "item-2"), origin: { source: "scheduler" } });
    expect(pending.rows.has("two")).toBe(false);
  });

  it("drops the record on a person's own publish, an unschedule, unpublish or trash", async () => {
    const { pending, run, holds } = setup();
    const grant = async () => {
      await run("content:beforeSchedule", scheduled("one", "item-1", admin));
      holds("one", at);
      await run("content:afterSchedule", stored("one", "item-1"));
      expect(pending.value("one")).toMatchObject({ confirmed: { by: "admin" } });
    };
    await grant();
    await run("content:beforePublish", event("one", "item-1"));
    expect(pending.rows.has("one")).toBe(false);
    // afterPublish of that publish changes nothing.
    await run("content:afterPublish", { collection: "products", content: { id: "one" } });
    expect(pending.rows.has("one")).toBe(false);
    for (const [hook, payload] of [
      ["content:afterUnschedule", { content: { id: "one" }, collection: "products" }],
      ["content:afterUnpublish", { content: { id: "one" }, collection: "products" }],
      ["content:afterDelete", { id: "one", collection: "products" }],
    ] as const) {
      await grant();
      await run(hook, payload);
      expect(pending.rows.has("one")).toBe(false);
    }
  });
});
