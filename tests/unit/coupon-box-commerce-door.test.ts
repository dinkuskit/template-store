import { beforeEach, describe, expect, it, vi } from "vitest";

// The store's runtime as EmDash hands it to server code: which plugins are loaded and which private POST routes they declare.
let routes: Record<string, string[]> = {};
vi.mock("emdash/middleware", () => ({
  withEmDashRuntime: async (run: (runtime: unknown) => Promise<unknown>) => run({
    configuredPlugins: Object.keys(routes).map((id) => ({ id })),
    getPluginRouteMeta: (id: string, path: string) => routes[id]?.includes(path) ? { public: false, methods: ["POST"] } : null,
  }),
}));

const { couponsInstalled } = await import("../../src/features/coupons/index.js");
const COMMERCE = "commerce-under-test";

describe("the coupon box takes codes only when checkout can carry them", () => {
  beforeEach(() => { routes = {}; });

  it("stays off when Commerce has no add-ons door, even with Coupons installed", async () => {
    routes = { [COMMERCE]: ["checkout/guest/start"], "dinkus-coupons": ["checkout/answer"] };
    expect(await couponsInstalled(COMMERCE)).toBe(false);
  });

  it("stays off without Coupons", async () => {
    routes = { [COMMERCE]: ["checkout/guest/start", "checkout/addons/start"] };
    expect(await couponsInstalled(COMMERCE)).toBe(false);
  });

  it("takes codes when Commerce has the door and Coupons is installed", async () => {
    routes = { [COMMERCE]: ["checkout/guest/start", "checkout/addons/start"], "dinkus-coupons": ["checkout/answer"] };
    expect(await couponsInstalled(COMMERCE)).toBe(true);
  });
});
