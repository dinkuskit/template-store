import { describe, expect, it } from "vitest";

import { createPlugin } from "../../src/features/product-url-plugin/index.js";

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

function context(pending = new Pending(), schedules = new Map<string, string | null>()) {
  const content = {
    async get(collection: string, id: string) {
      if (collection !== "products") return null;
      if (schedules.get(id) === undefined) throw new Error("unreadable");
      return { id, scheduledAt: schedules.get(id) };
    },
  };
  return { storage: { pending_sales: pending }, content } as never;
}

function event(id: string, slug = id) {
  return {
    collection: "products",
    // The shape EmDash passes: fields live under `data`.
    content: { id, slug, status: "draft", data: { title: id } },
    origin: { source: "api" as const },
  };
}

// template-drop-older-store-box-20261101: Commerce holds which product a page sells, so the plugin claims none.
describe("product URL publish and schedule", () => {
  it("lets every page with an entry ID publish and schedule, claiming no product", async () => {
    const plugin = createPlugin();
    expect(Object.keys(plugin.storage ?? {})).toEqual(["pending_sales"]);
    const publish = plugin.hooks["content:beforePublish"]!.handler;
    const schedule = plugin.hooks["content:beforeSchedule"]!.handler;
    await expect(publish(event("one"), context())).resolves.toBeUndefined();
    await expect(publish(event("two"), context())).resolves.toBeUndefined();
    await expect(schedule({ ...event("three"), scheduledAt: "2030-01-01T00:00:00Z" }, context())).resolves.toBeUndefined();
    await expect(publish({ ...event("four"), content: { slug: "four", status: "draft", data: {} } } as never, context())).resolves.toMatchObject({ cancel: true });
  });
});

describe("schedules recorded for the store's admin-visit sale", () => {
  const at = "2030-01-01T00:00:00Z";
  const admin = { id: "admin", role: 50 };
  const author = { id: "author", role: 30 };
  const scheduled = (id: string, actor?: { id: string; role: number }, scheduledAt = at) => ({
    ...event(id),
    scheduledAt,
    ...(actor ? { actor: { ...actor, source: "api" as const } } : {}),
  });
  // What EmDash hands content:afterSchedule once a schedule is stored; its copy of the time may be stale.
  const stored = (id: string, scheduledAt: string = at) => ({
    collection: "products",
    content: { id, slug: id, status: "scheduled", scheduledAt, data: {} },
  });
  // The schedule each page holds now, as EmDash stores it (milliseconds included).
  const setup = () => {
    const plugin = createPlugin();
    const pending = new Pending();
    const schedules = new Map<string, string | null>();
    const run = (hook: string, payload: unknown) =>
      (plugin.hooks as Record<string, { handler: (event: never, ctx: never) => Promise<unknown> }>)[hook]!.handler(payload as never, context(pending, schedules));
    const holds = (id: string, scheduledAt: string | null) => schedules.set(id, scheduledAt?.replace("Z", ".000Z") ?? null);
    return { pending, schedules, run, holds };
  };

  it("proposes the schedule first and grants it only once EmDash has stored it", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", admin));
    expect(pending.value("one")).toMatchObject({ proposals: [{ by: "admin", role: 50, scheduledAt: at }], confirmed: null, state: "scheduled" });
    holds("one", at);
    await run("content:afterSchedule", stored("one"));
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "admin", role: 50 }, state: "scheduled" });
  });

  it("grants nothing for a schedule that failed, came from no person, or does not match what EmDash holds", async () => {
    const { pending, run, holds } = setup();
    // An Author's schedule is stored; an admin's later attempt at another time fails, so the Author's stays granted.
    await run("content:beforeSchedule", scheduled("one", author));
    holds("one", at);
    await run("content:afterSchedule", stored("one"));
    await run("content:beforeSchedule", scheduled("one", admin, "2030-02-01T00:00:00Z"));
    expect(pending.value("one")).toMatchObject({ confirmed: { by: "author", role: 30 } });
    // A schedule from no person.
    await run("content:beforeSchedule", scheduled("two"));
    holds("two", at);
    await run("content:afterSchedule", stored("two"));
    expect(pending.value("two")).toMatchObject({ confirmed: null });
    // EmDash holds another time than the one proposed, or the page cannot be read, or is no longer scheduled.
    await run("content:beforeSchedule", scheduled("three", admin));
    holds("three", "2031-01-01T00:00:00Z");
    await run("content:afterSchedule", stored("three"));
    expect(pending.value("three")).toMatchObject({ confirmed: null });
    await run("content:beforeSchedule", scheduled("four", admin));
    await run("content:afterSchedule", stored("four"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
    holds("four", null);
    await run("content:afterSchedule", stored("four"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
  });

  it("never lends one request's authority to another's stored schedule", async () => {
    const { pending, run, holds } = setup();
    // Author A and admin B propose the same time; B's confirmation runs; admin C proposes before A's confirmation.
    await run("content:beforeSchedule", scheduled("one", author));
    await run("content:beforeSchedule", scheduled("one", admin));
    holds("one", at);
    await run("content:afterSchedule", stored("one"));
    expect(pending.value("one")).toMatchObject({ confirmed: null });
    await run("content:beforeSchedule", scheduled("one", { id: "admin-c", role: 50 }));
    await run("content:afterSchedule", stored("one"));
    expect(pending.value("one")).toMatchObject({ confirmed: null });
    // One admin's schedule is granted, then another person's proposal at that time withdraws the grant at once,
    // even if its confirmation never runs.
    await run("content:beforeSchedule", scheduled("two", admin));
    holds("two", at);
    await run("content:afterSchedule", stored("two"));
    expect(pending.value("two")).toMatchObject({ confirmed: { by: "admin" } });
    await run("content:beforeSchedule", scheduled("two", author));
    expect(pending.value("two")).toMatchObject({ confirmed: null });
    // The same person lowered to Author between two schedules at the same time is granted only their lower role.
    await run("content:beforeSchedule", scheduled("three", admin));
    holds("three", at);
    await run("content:afterSchedule", stored("three"));
    await run("content:beforeSchedule", scheduled("three", { id: "admin", role: 30 }));
    expect(pending.value("three")).toMatchObject({ confirmed: { by: "admin", role: 30 } });
    // A schedule from no person at the same time as an admin's grants nothing.
    await run("content:beforeSchedule", scheduled("four", admin));
    await run("content:beforeSchedule", scheduled("four"));
    holds("four", at);
    await run("content:afterSchedule", stored("four"));
    expect(pending.value("four")).toMatchObject({ confirmed: null });
    // A late confirmation carrying an older time grants from what EmDash holds now, not from its own copy.
    await run("content:beforeSchedule", scheduled("five", author));
    await run("content:beforeSchedule", scheduled("five", admin, "2030-03-01T00:00:00Z"));
    holds("five", at);
    await run("content:afterSchedule", stored("five", "2030-03-01T00:00:00Z"));
    expect(pending.value("five")).toMatchObject({ confirmed: { by: "author", role: 30 } });
  });

  it("grants nothing once more distinct schedules were asked for than are kept", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", author));
    for (let minute = 1; minute < 50; minute += 1) {
      await run("content:beforeSchedule", scheduled("one", admin, `2030-01-01T00:${String(minute).padStart(2, "0")}:00Z`));
    }
    // The same proposal again is kept once.
    await run("content:beforeSchedule", scheduled("one", author));
    expect(pending.value("one")).toMatchObject({ overflowed: false });
    // One more distinct proposal: nothing is evicted, and nothing is granted until the record is removed.
    await run("content:beforeSchedule", scheduled("one", admin, "2030-01-01T01:00:00Z"));
    holds("one", "2030-01-01T01:00:00Z");
    await run("content:afterSchedule", stored("one", "2030-01-01T01:00:00Z"));
    expect(pending.value("one")).toMatchObject({ overflowed: true, confirmed: null });
    expect((pending.value("one")?.proposals as unknown[]).length).toBe(50);
  });

  it("marks a granted schedule published only through EmDash's own scheduled publish", async () => {
    const { pending, run, holds } = setup();
    await run("content:beforeSchedule", scheduled("one", admin));
    holds("one", at);
    await run("content:afterSchedule", stored("one"));
    await run("content:beforePublish", { ...event("one"), origin: { source: "scheduler" } });
    expect(pending.value("one")).toMatchObject({ state: "publishing" });
    await run("content:afterPublish", { collection: "products", content: { id: "one" } });
    expect(pending.value("one")).toMatchObject({ state: "published", confirmed: { by: "admin" } });
    // A scheduled publish without a grant leaves no record.
    await run("content:beforeSchedule", scheduled("two", admin));
    await run("content:beforePublish", { ...event("two"), origin: { source: "scheduler" } });
    expect(pending.rows.has("two")).toBe(false);
  });

  it("drops the record on a person's own publish, an unschedule, unpublish or trash", async () => {
    const { pending, run, holds } = setup();
    const grant = async () => {
      await run("content:beforeSchedule", scheduled("one", admin));
      holds("one", at);
      await run("content:afterSchedule", stored("one"));
      expect(pending.value("one")).toMatchObject({ confirmed: { by: "admin" } });
    };
    await grant();
    await run("content:beforePublish", event("one"));
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
