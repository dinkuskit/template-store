import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIContext, MiddlewareHandler } from "astro";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: MiddlewareHandler) => handler }));
vi.mock("../../src/features/playground/demo-products.js", () => ({ isDemoCatalogProfile: () => false }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({
  ensurePlaygroundDemoCatalog: () => { throw new Error("Unexpected catalog seed"); },
}));

import { onRequest } from "../../src/middleware.js";
import { CHECKOUT_READINESS_SCHEMA } from "../../src/features/guest-cart/checkout-admission.js";

const endpoint = "https://store.example.test/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/start";
afterEach(() => vi.unstubAllEnvs());

async function invoke(hosting: string, supported: boolean, catalogProfile = "shipping") {
  vi.stubEnv("DINKUS_HOSTING_PROFILE", hosting);
  vi.stubEnv("DINKUS_STOREFRONT_PROFILE", "shipping");
  vi.stubEnv("DINKUS_PROOF_MODE", "0");
  vi.stubEnv("DINKUS_EMDASH_ADMIN_ENABLED", "0");
  vi.stubEnv("DINKUS_CATALOG_PROFILE", catalogProfile);
  const dispatch = vi.fn(async () => ({ success: true, data: supported
    ? { schema: CHECKOUT_READINESS_SCHEMA, status: "supported", mode: "test" }
    : { schema: CHECKOUT_READINESS_SCHEMA, status: "unavailable" } }));
  const request = new Request(endpoint, { method: "POST", body: "{}" });
  const context = {
    request, url: new URL(request.url), locals: { emdash: { handlePublicPluginApiRoute: dispatch } },
    cookies: { get: () => undefined },
  } as unknown as APIContext;
  const next = vi.fn(async () => Response.json({ dispatched: true }));
  const response = await onRequest(context, next);
  return { response, next, dispatch };
}

describe("installed checkout middleware", () => {
  for (const hosting of ["node", "cloudflare"]) {
    it(`${hosting}: allows the original handler only after anonymous installed readiness`, async () => {
      const { response, next, dispatch } = await invoke(hosting, true);
      expect(response?.status).toBe(200);
      expect(next).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
    });
    it(`${hosting}: keeps unconfigured checkout closed`, async () => {
      const { response, next } = await invoke(hosting, false);
      expect(response?.status).toBe(503);
      expect(next).not.toHaveBeenCalled();
      expect(response?.headers.get("cache-control")).toBe("no-store");
    });
  }
  it("refuses Registry checkout against the native catalog profile before dispatch", async () => {
    const { response, next, dispatch } = await invoke("node", true, "native-development");
    expect(response?.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
