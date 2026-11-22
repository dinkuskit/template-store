import { inboxDoor, outboxDoor } from "@dinkuskit/courier/doors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { emdashPublishes, runtimes } = vi.hoisted(() => ({ emdashPublishes: vi.fn(), runtimes: [] as unknown[] }));

vi.mock("@astrojs/cloudflare/entrypoints/server", () => ({ default: { fetch: vi.fn() } }));
vi.mock("@emdash-cms/cloudflare/worker", () => ({
  createScheduledHandler: () => (...args: unknown[]) => emdashPublishes(...args),
  PluginBridge: class PluginBridge {},
}));
// EmDash's own entry point for work outside a request. Each call hands the
// courier the store's runtime, as it does in the Worker.
vi.mock("emdash/middleware", () => ({
  withEmDashRuntime: async (run: (runtime: unknown) => unknown) => run(runtimes.shift()),
}));

import { createScheduledHandler } from "../../src/worker.js";

type Door = (route: { input: unknown; user?: unknown }, ctx: { kv: Kv }) => Promise<unknown>;
type Kv = ReturnType<typeof memoryKv>;

/** A plugin's own key-value storage, with the revisions EmDash's has. */
function memoryKv() {
  const values = new Map<string, { value: unknown; revision: string }>();
  let revision = 0;
  return {
    get: async (key: string) => values.get(key)?.value ?? null,
    set: async (key: string, value: unknown) => void values.set(key, { value, revision: String(++revision) }),
    getVersioned: async (key: string) => values.get(key) ?? null,
    compareAndSet: async (key: string, expected: string | null, value: unknown) => {
      if ((values.get(key)?.revision ?? null) !== expected) return { applied: false };
      values.set(key, { value, revision: String(++revision) });
      return { applied: true };
    },
  };
}

/**
 * A store with Commerce sending `order.shipped` and Reviews listening, both
 * built from the courier's real doors and reached the way EmDash reaches a
 * plugin route: by id and route name, with the person (if any) passed last.
 */
function store(shipments: Array<{ id: string; at: string; data: Record<string, unknown> }>) {
  const saved: string[] = [];
  const callers: unknown[] = [];
  const doors: Record<string, Door> = {
    "dinkus-commerce courier/outbox": (outboxDoor({
      "order.shipped": async ({ after, limit }) => {
        const start = after === null ? 0 : Number(after);
        const items = shipments.slice(start, start + limit);
        return { items, next: String(start + items.length), more: start + items.length < shipments.length };
      },
    }) as unknown as { handler: Door }).handler,
    "dinkus-reviews courier/inbox": (inboxDoor({
      wants: [{ from: "dinkus-commerce", topic: "order.shipped" }],
      deliver: async ({ items }) => {
        const fresh = items.filter((item) => !saved.includes(item.id));
        saved.push(...fresh.map((item) => item.id));
        return fresh.length;
      },
    }) as unknown as { handler: Door }).handler,
  };
  const kv = { "dinkus-commerce": memoryKv(), "dinkus-reviews": memoryKv() } as Record<string, Kv>;
  const runtime = {
    configuredPlugins: [{ id: "dinkus-commerce" }, { id: "dinkus-reviews" }],
    sandboxedPlugins: new Map(),
    getPluginRouteMeta: (id: string, route: string) =>
      doors[`${id} ${route}`] ? { public: false, methods: ["POST"] } : null,
    async handlePluginApiRoute(id: string, _method: string, route: string, request: Request, user?: unknown) {
      callers.push(user);
      try {
        const data = await doors[`${id} ${route}`]({ input: await request.json(), user }, { kv: kv[id] });
        return { success: true, data };
      } catch (error) {
        return { success: false, error: { code: "ROUTE_ERROR", message: String(error) } };
      }
    },
  };
  return { runtime, saved, callers };
}

const shipment = (order: string) => ({ id: `${order}:shipment-1`, at: "2026-11-22T12:00:00.000Z", data: { orderId: order } });
const minute = { scheduledTime: Date.parse("2026-11-22T12:01:00Z"), cron: "* * * * *", noRetry() {} };

function waitUntilCollector() {
  const kept: Promise<unknown>[] = [];
  return { kept, ctx: { waitUntil: (promise: Promise<unknown>) => kept.push(promise), passThroughOnException() {} } };
}

describe("the store's one-minute timer runs the courier", () => {
  beforeEach(() => {
    emdashPublishes.mockClear();
    runtimes.length = 0;
  });

  it("carries Commerce's shipped orders to Reviews with nobody signed in, after EmDash's own scheduled publishing", async () => {
    const shop = store([shipment("order-1"), shipment("order-2")]);
    runtimes.push(shop.runtime, shop.runtime);
    const scheduled = createScheduledHandler();

    const first = waitUntilCollector();
    scheduled(minute, {}, first.ctx);
    expect(emdashPublishes).toHaveBeenCalledTimes(1);
    // The Worker keeps the run alive until it finishes.
    expect(first.kept).toHaveLength(1);
    const report = await first.kept[0];
    expect(report).toMatchObject({ receivers: 1, delivered: 2, unfinished: false, problems: [] });
    expect(shop.saved).toEqual(["order-1:shipment-1", "order-2:shipment-1"]);
    expect(shop.callers.every((user) => user === undefined)).toBe(true);

    // The next minute finds nothing new.
    const second = waitUntilCollector();
    scheduled({ ...minute, scheduledTime: minute.scheduledTime + 60_000 }, {}, second.ctx);
    expect(await second.kept[0]).toMatchObject({ delivered: 0, problems: [] });
    expect(shop.saved).toHaveLength(2);
  });

  it("a courier that cannot reach the store logs it and leaves the timer working", async () => {
    runtimes.push(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { kept, ctx } = waitUntilCollector();
    createScheduledHandler()(minute, {}, ctx);
    expect(emdashPublishes).toHaveBeenCalledTimes(1);
    await expect(kept[0]).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("[courier] the run failed:", expect.any(String));
    warn.mockRestore();
  });

  it("does not run for a timer the store did not set", () => {
    const { kept, ctx } = waitUntilCollector();
    createScheduledHandler({ generalCron: "* * * * *" })({ ...minute, cron: "0 0 * * *" }, {}, ctx);
    expect(kept).toHaveLength(0);
  });
});
