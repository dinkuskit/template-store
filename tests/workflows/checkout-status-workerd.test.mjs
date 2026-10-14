import assert from "node:assert/strict";
import test from "node:test";
import { checkout, statusFixture } from "./helpers/status-public-dispatch.mjs";

test("status uses the existing public dispatcher under workerd without HTTP", async () => {
  const fixture = await statusFixture({ success: true, extra: "private", data: {
    ok: true, capabilityId: "cap", checkout: { ...checkout, extra: "private" },
    capability: { capabilityId: "cap", capability: "cap.synthetic", retention: "json-body", header: "x-commerce-guest-capability" },
  } });
  try {
    const response = await fixture.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-fixture-dispatch-calls"), "1");
    assert.deepEqual(await response.json(), { ok: true, capabilityId: "cap", checkout });
    assert.equal(fixture.outbound(), 0);
  } finally { await fixture.close(); }
});

for (const options of [{ publicRoute: false }, { missingLocals: true }]) {
  test(`status fails closed for unavailable public dispatch ${JSON.stringify(options)}`, async () => {
    const fixture = await statusFixture({ success: true, data: { ok: true, capabilityId: "cap", checkout } }, options);
    try {
      const response = await fixture.request();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("x-fixture-dispatch-calls"), "0");
      assert.equal(fixture.outbound(), 0);
    } finally { await fixture.close(); }
  });
}
