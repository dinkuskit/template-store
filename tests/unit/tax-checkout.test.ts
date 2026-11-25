import { beforeEach, describe, expect, it, vi } from "vitest";

// The store's runtime as EmDash hands it to server code: the loaded plugins, their private POST routes, and what
// Tax's checkout/answer route gives back.
let routes: Record<string, string[]> = {};
// The store's active Registry installs (_plugin_state), or "unreadable" when the query fails; null: no database.
let registry: { plugin_id: string; registry_slug: string }[] | "unreadable" | null = null;
let noRuntime = false;
let reply: (body: unknown) => unknown = () => ({ success: true, data: { answer: null } });
const asked: unknown[] = [];
const db = {
  selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({
    execute: async () => { if (registry === "unreadable") throw new Error("D1 down"); return registry; },
  }) }) }) }),
};
vi.mock("emdash/middleware", () => ({
  withEmDashRuntime: async (run: (runtime: unknown) => Promise<unknown>) => {
    if (noRuntime) throw new Error("no runtime");
    return run({
      ...(registry ? { db } : {}),
      configuredPlugins: Object.keys(routes).map((id) => ({ id })),
      getPluginRouteMeta: (id: string, path: string) => routes[id]?.includes(path) ? { public: false, methods: ["POST"] } : null,
      handlePluginApiRoute: async (_id: string, _method: string, _path: string, request: Request) => {
        const body = await request.json();
        asked.push(body);
        return reply(body);
      },
    });
  },
}));

const { checkTax, parseTaxAnswer, taxLines } = await import("../../src/features/tax/index.js");

const snapshot = (id: string, unitMinor: string) => ({ id, found: true, price: { unitMinor } });
// A cart in the order the shopper added it; Commerce names its lines sorted by catalog item id.
const page = {
  result: { ok: true, cart: { lines: [{ catalogItemId: "mug", quantity: 2 }, { catalogItemId: "boots", quantity: 1 }] } },
  snapshots: [snapshot("mug", "1500"), snapshot("boots", "8000")],
} as never;
const ctx = { locals: {}, url: new URL("https://store.example.test/checkout"), request: new Request("https://store.example.test/checkout"), cookies: {} } as never;
const delivery = { name: "Ana Buyer", line1: "1 Public Square", city: "Nashville", region: "TN", postalCode: "37201", country: "US" };
const lines = [{ item: "boots", price: "8000", qty: 1 }, { item: "mug", price: "1500", qty: 2 }];
const answer = {
  from: "dinkus-tax", ref: "8f0c", to: "1 Public Square\n\nNashville\nTN\n37201\nUS", shipRate: "97500",
  lines: [{ item: "boots", price: "8000", qty: 1, off: "0", rate: "97500" }, { item: "mug", price: "1500", qty: 2, off: "0", rate: "97500" }],
};

describe("the lines Tax is asked about", () => {
  it("are Commerce's lines, sorted by catalog item id, with unit prices in cents", () => {
    expect(taxLines(page)).toEqual(lines);
  });

  it("are none when a price is unknown, so checkout never starts with a line Tax did not see", () => {
    expect(taxLines({ ...(page as object), snapshots: [snapshot("mug", "1500")] } as never)).toBeNull();
  });
});

describe("Tax's answer", () => {
  it("passes an answer naming every line with the price and quantity sent, and no answer at all", () => {
    expect(parseTaxAnswer({ answer }, lines)).toEqual({ answer });
    expect(parseTaxAnswer({ answer: null }, lines)).toEqual({ answer: null });
    // The Orders note travels as a code, kept with the order.
    const noted = { ...answer, codes: ["by-ZIP,-check-address"] };
    expect(parseTaxAnswer({ answer: noted }, lines)).toEqual({ answer: noted });
  });

  it("refuses other lines, an amount off, a rate or code out of shape, or another plugin's answer", () => {
    expect(parseTaxAnswer({ answer: { ...answer, lines: answer.lines.slice(0, 1) } }, lines)).toBeNull();
    expect(parseTaxAnswer({ answer: { ...answer, lines: [{ ...answer.lines[0], off: "100" }, answer.lines[1]] } }, lines)).toBeNull();
    expect(parseTaxAnswer({ answer: { ...answer, lines: [{ ...answer.lines[0], rate: "9.75" }, answer.lines[1]] } }, lines)).toBeNull();
    expect(parseTaxAnswer({ answer: { ...answer, shipRate: "1000000" } }, lines)).toBeNull();
    expect(parseTaxAnswer({ answer: { ...answer, from: "dinkus-coupons" } }, lines)).toBeNull();
    for (const codes of ["by-ZIP", ["by ZIP"], [""], ["x".repeat(65)], Array(7).fill("x"), [1]]) {
      expect(parseTaxAnswer({ answer: { ...answer, codes } }, lines)).toBeNull();
    }
    expect(parseTaxAnswer({}, lines)).toBeNull();
  });
});

describe("checkout asks Tax as it starts", () => {
  beforeEach(() => { routes = {}; registry = null; noRuntime = false; asked.length = 0; reply = () => ({ success: true, data: { answer } }); });

  it("starts untaxed when Tax is not installed, and asks nothing", async () => {
    expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "none" });
    expect(asked).toEqual([]);
  });

  it("sends the delivery address and the lines, and passes the answer on", async () => {
    routes = { "dinkus-tax": ["checkout/answer"] };
    expect(await checkTax(ctx, page, { email: "ana@example.test", delivery, billing: { ...delivery, line1: "9 Other St" } })).toEqual({ kind: "answer", answer });
    expect(asked).toEqual([{ address: delivery, lines }]);
  });

  it("sends the billing address when nothing ships", async () => {
    routes = { "dinkus-tax": ["checkout/answer"] };
    await checkTax(ctx, page, { email: "ana@example.test", billing: delivery });
    expect(asked).toEqual([{ address: delivery, lines }]);
  });

  it("starts untaxed when the order's state is not switched on", async () => {
    routes = { "dinkus-tax": ["checkout/answer"] };
    reply = () => ({ success: true, data: { answer: null } });
    expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "none" });
  });

  it("waits when Tax is installed but refuses, fails or answers out of shape, so no order goes untaxed by mistake", async () => {
    routes = { "dinkus-tax": ["checkout/answer"] };
    for (const failing of [() => ({ success: false, error: { code: "ROUTE_ERROR" } }), () => { throw new Error("down"); }, () => ({ success: true, data: { answer: { ...answer, from: "x" } } })]) {
      reply = failing;
      expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "unavailable" });
    }
  });

  it("starts untaxed when the store's Registry installs hold no Tax", async () => {
    registry = [{ plugin_id: "r_coupons", registry_slug: "dinkus-coupons" }];
    expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "none" });
    expect(asked).toEqual([]);
  });

  it("asks the Registry install of Tax by its own id", async () => {
    registry = [{ plugin_id: "r_tax", registry_slug: "dinkus-tax" }];
    routes = { r_tax: ["checkout/answer"] };
    expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "answer", answer });
  });

  it("waits when Tax is installed but cannot be asked, or the store cannot tell whether it is", async () => {
    const waits = async () => {
      expect(await checkTax(ctx, page, { email: "ana@example.test", delivery })).toEqual({ kind: "unavailable" });
      expect(asked).toEqual([]);
    };
    // Loaded by its own id without a private POST checkout/answer.
    routes = { "dinkus-tax": [] };
    await waits();
    // A Registry install that is not loaded, or without the route.
    routes = {};
    registry = [{ plugin_id: "r_tax", registry_slug: "dinkus-tax" }];
    await waits();
    routes = { r_tax: [] };
    await waits();
    // Two installs: which one is the store's is not clear.
    routes = { r_tax: ["checkout/answer"], r_tax2: ["checkout/answer"] };
    registry = [{ plugin_id: "r_tax", registry_slug: "dinkus-tax" }, { plugin_id: "r_tax2", registry_slug: "dinkus-tax" }];
    await waits();
    // The plugin list cannot be read, or there is no store runtime at all.
    routes = {};
    registry = "unreadable";
    await waits();
    registry = null;
    noRuntime = true;
    await waits();
  });
});
