/**
 * The playground's wrapper around Commerce's shopper-account routes. Commerce's Registry routes refuse in-band
 * ({ success: true, data: { ok: false, error } }); a refused sign-in must reach the shopper as Commerce gave it
 * and record no lead, while a verified sign-in still records one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({ ensurePlaygroundDemoCatalog: vi.fn(async () => ({ created: [] })) }));
const recordVerifiedPlaygroundLead = vi.fn(async () => true);
vi.mock("../../src/features/shopper-account/playground-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordVerifiedPlaygroundLead,
}));

const { onRequest } = await import("../../src/middleware.js");
const { COMMERCE_REGISTRY_RUNTIME_ID } = await import("../../src/features/guest-cart/checkout-protocol.js");

const ORIGIN = "https://playground.example";
const verifyPath = `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/account/sign-in/verify`;

async function verify(answer: unknown) {
  const request = new Request(`${ORIGIN}${verifyPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ email: "shopper@example.test", code: "000000", optInUpdates: true }),
  });
  const dispatch = vi.fn(async () => answer);
  const locals: Record<string, unknown> = {
    emdash: { handlePublicPluginApiRoute: dispatch },
    __playgroundDb: {},
    __playgroundEnv: { DINKUS_LOCAL_PROOF: "1" },
  };
  const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)({
    url: new URL(request.url), request, locals, cookies: { get: () => ({ value: "pg-session" }) },
  }, vi.fn(async () => new Response("next", { status: 599 })));
  return { response, dispatch };
}

afterEach(() => { recordVerifiedPlaygroundLead.mockClear(); });

describe("playground shopper-account wrapper", () => {
  it("returns Commerce's in-band refusal of a wrong or expired PIN as Commerce gave it, and records no lead", async () => {
    for (const code of ["CODE_INVALID", "CODE_EXPIRED"]) {
      const refusal = { success: true, data: { ok: false, error: { code, message: "That code is not valid." } } };
      const { response, dispatch } = await verify(refusal);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, data: refusal.data });
      expect(recordVerifiedPlaygroundLead).not.toHaveBeenCalled();
    }
  });

  it("records the verified email as an opted-in lead when Commerce signs the shopper in", async () => {
    const signedIn = { success: true, data: { ok: true, profile: { email: "shopper@example.test" }, capability: { sessionId: "s1", session: "tok" } } };
    const { response } = await verify(signedIn);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: signedIn.data });
    expect(recordVerifiedPlaygroundLead).toHaveBeenCalledWith("shopper@example.test", expect.anything());
  });
});
