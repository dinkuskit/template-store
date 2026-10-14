import assert from "node:assert/strict";
import test from "node:test";
import { checkout, statusFixture } from "./helpers/status-public-dispatch.mjs";
const envelope = code => ({ success: true, data: { ok: false, error: { code, message: "private-message", details: "private-details" } } });
for (const [name, payload, code] of [
  ["origin", envelope("ORIGIN_DENIED"), "CHECKOUT_STATUS_ORIGIN_DENIED"],
  ["capability", envelope("CAPABILITY_DENIED"), "CHECKOUT_STATUS_CAPABILITY_DENIED"],
  ["missing checkout", envelope("CHECKOUT_NOT_FOUND"), "CHECKOUT_STATUS_NOT_FOUND"],
  ["unavailable", envelope("UNAVAILABLE"), "CHECKOUT_STATUS_UNAVAILABLE"],
  ["payments unavailable", envelope("PAYMENTS_UNAVAILABLE"), "CHECKOUT_STATUS_UNAVAILABLE"],
  ["unknown", envelope("private-code"), "CHECKOUT_UNAVAILABLE"],
  ["private host error", { success: false, error: { code: "NOT_FOUND", message: "private-message" } }, "CHECKOUT_UNAVAILABLE"],
  ["malformed", { success: true, data: { ok: true } }, "CHECKOUT_STATUS_RESPONSE_INVALID"],
  ["oversized", { success: true, data: { ok: true, capabilityId: "cap", checkout: { ...checkout, private: "x".repeat(65537) } } }, "CHECKOUT_STATUS_RESPONSE_INVALID"],
]) {
  test(`native public dispatcher exposes only safe ${name} diagnostic`, async () => {
    const fixture = await statusFixture(payload);
    try {
      const response = await fixture.request();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { ok: false, error: { code, message: "Checkout status unavailable." } });
      assert.equal(fixture.outbound(), 0);
    } finally { await fixture.close(); }
  });
}
