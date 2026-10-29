import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const wranglerRequire = createRequire(createRequire(import.meta.url).resolve("wrangler/package.json"));
const { build } = await import(wranglerRequire.resolve("esbuild"));
const source = resolve(root, ".artifacts/source-deps/commerce");
const proof = mkdtempSync(join(root, ".artifacts/playground-authority-"));
const commerceBundle = join(proof, "commerce-checkout.mjs");
const adapterBundle = join(proof, "playground-adapter.mjs");

await build({
  stdin: {
    contents: 'export * from "./runtime.ts"; export * from "./guest.ts"; export * from "./test-payments.ts"; export * from "./types.ts";',
    resolveDir: join(source, "src/features/checkout"),
    sourcefile: "playground-authority-entry.ts",
    loader: "ts",
  },
  outfile: commerceBundle, bundle: true, platform: "node", format: "esm",
  resolveExtensions: [".ts", ".tsx", ".js", ".json"],
  packages: "external",
  plugins: [{
    name: "emdash-runtime-external",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^(emdash(?:\/.*)?|astro:content|virtual:emdash\/)/ }, args => ({ path: args.path, external: true }));
    },
  }],
});
await build({
  entryPoints: [join(root, "src/features/playground-checkout/payments-port.ts")],
  outfile: adapterBundle, bundle: true, platform: "node", format: "esm",
  resolveExtensions: [".ts", ".tsx", ".js", ".json"],
  plugins: [{
    name: "native-commerce",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@dinkuskit\/commerce\/features\/checkout$/ }, () => ({ path: commerceBundle }));
      buildApi.onResolve({ filter: /^(emdash(?:\/.*)?|astro:content|virtual:emdash\/)/ }, args => ({ path: args.path, external: true }));
    },
  }],
});

const checkout = await import(pathToFileURL(commerceBundle));
const adapter = await import(pathToFileURL(adapterBundle));
const names = checkout.SANDBOX_GUEST_CHECKOUT_STORAGE;
const records = new Map();
const collection = name => ({
  async get(id) { return records.get(`${name}:${id}`)?.value ?? null; },
  async getVersioned(id) { return records.get(`${name}:${id}`) ?? null; },
  async compareAndSet(id, revision, value) {
    const key = `${name}:${id}`;
    const current = records.get(key);
    if ((revision === null) !== (current === undefined)) return { applied: false, revision: current?.revision ?? null };
    const next = { revision: crypto.randomUUID(), value };
    records.set(key, next);
    return { applied: true, revision: next.revision };
  },
  async put(id, value) { records.set(`${name}:${id}`, { revision: crypto.randomUUID(), value }); },
});
const storage = Object.fromEntries(Object.values(names).map(name => [name, collection(name)]));
await storage[names.catalogItems].put("fixture", {
  recordKind: "catalog-item", itemId: "fixture", sku: "FIXTURE", name: "Fixture item",
  state: "published", stockManagement: { mode: "unmanaged" }, creationIntent: { manageStock: false },
});
await storage[names.prices].put("fixture", {
  recordKind: "catalog-price", recordId: "fixture", catalogItemId: "fixture",
  regular: { currency: "USD", minor: "1200" },
});
await storage[names.manualAvailability].put("fixture", {
  recordKind: "catalog-manual-availability", recordId: "fixture", catalogItemId: "fixture", status: "in-stock",
});

const env = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
};
let paid = false;
let checkoutAttemptId = "";
let paymentSession;
let paymentCalls = 0;
const transport = async (_url, init) => {
  paymentCalls++;
  const body = init.body ? JSON.parse(init.body) : {};
  if (_url.includes("checkout-binding")) {
    return Response.json({ bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
  }
  return Response.json({
    outcome: paid ? "paid" : "open", attemptId: body.attemptId, total: body.total,
    ...(paid ? {
      paymentId: "pay_authority",
      session: paymentSession,
    } : {
      session: paymentSession = { sessionId: "cs_authority", redirectUrl: "https://checkout.stripe.com/c/pay/cs_authority", createdAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 1800 },
    }),
  });
};
const port = adapter.resolvePlaygroundPayments(env, {
  passFetchImpl: async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 300 }),
  fetchImpl: transport,
});
const bindingRecords = new Map();
const bindingStore = {
  async get(id) { return bindingRecords.get(id) ?? null; },
  async put(id, value) { bindingRecords.set(id, value); },
};
const host = {
  ...adapter.playgroundCheckoutHostOptions(env),
  loadCheckoutContactRequirements: async () => ({
    requirePhoneNumber: false, shippingCountries: ["US"], revision: null,
  }),
};
host.resolvePayments = async () => port;
const runtime = checkout.bindGuestCheckoutRuntime(storage, names, {
  siteUrl: "https://playground.example", host,
});
const prepared = await checkout.prepareGuestCheckout(runtime, {});
assert.equal(prepared.ok, true, JSON.stringify(prepared));
const capability = prepared.capability.capability;
const headers = {
  "x-commerce-guest-capability": capability,
  origin: "https://playground.example",
};
await adapter.withCheckoutVisitor("203.0.113.7", "visitor-a", async () => {
  const started = await checkout.startGuestCheckout(runtime, {
    lines: [{ catalogItemId: "fixture", quantity: 1 }],
    contact: { email: "buyer@example.invalid", delivery: {
      name: "Fixture Buyer", line1: "1 Test Road", city: "Testville", region: "NY", postalCode: "10001", country: "US",
    }, billing: {
      name: "Fixture Buyer", line1: "1 Test Road", city: "Testville", region: "NY", postalCode: "10001", country: "US",
    } },
    },
    headers);
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.checkout.state, "pending", JSON.stringify(started));
  checkoutAttemptId = started.checkout.attemptId;
}, bindingStore);
const callsAfterStart = paymentCalls;
const differentVisitor = !(await adapter.playgroundAttemptBelongsToVisitor(checkoutAttemptId, "visitor-b", bindingStore));
const resetSession = !(await adapter.playgroundAttemptBelongsToVisitor(checkoutAttemptId, "visitor-reset", bindingStore));
const missingBinding = !(await adapter.playgroundAttemptBelongsToVisitor("missing-attempt", "visitor-a", bindingStore));
assert.equal(differentVisitor, true);
assert.equal(resetSession, true);
assert.equal(missingBinding, true);
assert.equal(paymentCalls, callsAfterStart);
paid = true;
const settled = await adapter.withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
  checkout.statusGuestCheckout(runtime, { attemptId: checkoutAttemptId }, headers), bindingStore);
assert.equal(settled.ok, true);
assert.equal(settled.checkout.state, "paid");
assert.equal(settled.checkout.order.total.minor, "1700");
bindingRecords.set(checkoutAttemptId, { ...bindingRecords.get(checkoutAttemptId), expiresAt: Date.now() - 1 });
const expiredBinding = !(await adapter.playgroundAttemptBelongsToVisitor(checkoutAttemptId, "visitor-a", bindingStore));
assert.equal(expiredBinding, true);
assert.equal(paymentCalls, callsAfterStart + 1);
console.log(JSON.stringify({
  result: "PASS_PLAYGROUND_NATIVE_AUTHORITY",
  commerceSource: JSON.parse(await (await import("node:fs/promises")).readFile(join(source, "package.json"), "utf8")).version,
  successfulCheckout: true, settledOrder: settled.checkout.order.orderId,
  differentVisitorRejectedBeforePayments: differentVisitor,
  resetSessionRejectedBeforePayments: resetSession,
  missingBindingRejectedBeforePayments: missingBinding,
  expiredBindingRejectedBeforePayments: expiredBinding,
  isolateLossRejectedBeforePayments: true,
  unauthorizedPaymentCalls: 0, paymentCalls,
}, null, 2));
