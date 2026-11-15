import { describe, expect, it } from "vitest";
import { isShopperSessionDenied, unwrapPluginEnvelope } from "../../src/features/shopper-account/index.js";

const denied = { ok: false, error: { code: "SESSION_DENIED", message: "This customer session is not valid." } };
describe("definitive shopper-session denial", () => {
  it.each([
    { status: 401, payload: null, expected: true },
    { status: 401, payload: "not JSON", expected: true },
    { status: 200, payload: denied, expected: true },
    { status: 200, payload: { success: true, data: denied }, expected: true },
    { status: 200, payload: { ok: true, profile: {} }, expected: false },
    { status: 200, payload: { ok: false, error: { code: "UNAVAILABLE" } }, expected: false },
    { status: 200, payload: { success: false, error: { code: "UNAUTHORIZED" } }, expected: false },
    { status: 200, payload: { error: { code: "SESSION_DENIED" } }, expected: false },
    { status: 200, payload: null, expected: false },
    { status: 403, payload: { ok: false, error: { code: "FORBIDDEN" } }, expected: false },
    { status: 500, payload: denied, expected: false },
    { status: 503, payload: { success: true, data: denied }, expected: false },
  ])("classifies $status $payload without treating service errors as revocation", ({ status, payload, expected }) => {
    expect(isShopperSessionDenied(status, unwrapPluginEnvelope(payload))).toBe(expected);
  });
});
