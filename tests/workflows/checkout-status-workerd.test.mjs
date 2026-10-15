import assert from "node:assert/strict";
import test from "node:test";
import { checkout, statusFixture } from "./helpers/status-public-dispatch.mjs";

for (const profile of ["stable", "beta"]) {
test(`${profile}: status uses the existing public dispatcher under workerd without HTTP`, async () => {
  const fixture = await statusFixture({ success: true, extra: "private", data: {
    ok: true, capabilityId: "cap", checkout: { ...checkout, extra: "private" },
    capability: { capabilityId: "cap", capability: "cap.synthetic", retention: "json-body", header: "x-commerce-guest-capability" },
  } }, { profile });
  try {
    const response = await fixture.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-fixture-dispatch-calls"), "1");
    assert.deepEqual(await response.json(), { ok: true, capabilityId: "cap", checkout });
    assert.equal(fixture.outbound(), 0);
  } finally { await fixture.close(); }
});

for (const options of [{ publicRoute: false, profile }, { missingLocals: true, profile }]) {
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

}

for (const profile of ["stable", "beta"]) {
  test(`${profile}: status refuses foreign origin before dispatch`, async () => {
    const fixture = await statusFixture({ success: true, data: { ok: true, capabilityId: "cap", checkout } }, { profile });
    try {
      const response = await fixture.request({ origin: "https://foreign.example" });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("x-fixture-dispatch-calls"), "0");
      assert.equal(fixture.outbound(), 0);
    } finally { await fixture.close(); }
  });
}
