import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { encryptPluginSetting } from "emdash";

// Run with the paired Commerce Registry build and dinkuskit-stand-in.mjs. No provider navigation.
test("a full variant cart receives the TEST payment redirect", async ({ page, browser }, info) => {
  const stateFile = process.env.DINKUS_PAIRED_STAND_IN_STATE;
  const dbFile = process.env.DINKUS_PAIRED_DB;
  test.skip(!stateFile || !dbFile || !(globalThis as { __dinkusPairedStandIn?: boolean }).__dinkusPairedStandIn,
    "requires the paired Registry store and the TEST Payments stand-in");
  test.setTimeout(240_000);

  const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
  const plugin = `/_emdash/api/plugins/${commerce}`;
  const setup = await page.request.get("/_emdash/api/setup/dev-bypass?content=0");
  expect(setup.ok()).toBe(true);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass")).ok()).toBe(true);
  const origin = new URL(setup.url()).origin;
  const state = { storeKey: `dk_store_${"q".repeat(43)}`, siteId: "large-checkout", bindingRef: "large-checkout-binding", stripeAccountId: "acct_1PairedCartForm", expired: [] };
  const settings = JSON.stringify({ schema: "dinkuskit.commerce.registry-checkout/v1", enabled: true,
    commerceOrigin: origin, siteId: state.siteId, paymentsOrigin: "https://payments.dinkuskit.com",
    bindingRef: state.bindingRef, providerId: "stripe", stripeAccountId: state.stripeAccountId, mode: "test",
    pricingSchema: "dinkuskit.commerce.checkout-pricing/v1", issuer: "https://dinkuskit.com/account", audience: "dinkus-payments",
    shipping: { configurationId: "large-checkout-free", revision: 1, mode: "free" },
  });
  const db = new DatabaseSync(dbFile!);
  try {
    const installed = `plugin:${commerce}:settings:installedCheckout`;
    if (!db.prepare("SELECT 1 FROM options WHERE name = ?").get(installed)) {
      writeFileSync(stateFile!, JSON.stringify({ ...state, settings }));
      writeFileSync(`${stateFile}.calls.jsonl`, "");
      const connection = await encryptPluginSetting(commerce, "connection", JSON.stringify({ siteId: state.siteId, storeKey: state.storeKey }));
      const put = db.prepare("INSERT INTO options (name, value, revision) VALUES (?, ?, ?)");
      put.run(`plugin:${commerce}:settings:connection`, JSON.stringify(connection), crypto.randomUUID());
      put.run(installed, JSON.stringify(settings), crypto.randomUUID());
    }
  } finally { db.close(); }

  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data, headers: { Origin: origin, "X-EmDash-Request": "1" } });
    const body = await response.json();
    expect(body.success, `${path}: ${response.status()} ${body.error?.code ?? ""}`).toBe(true);
    return body.data;
  };
  const catalog = (body: unknown) => post(`${plugin}/catalog`, body);
  const slug = `large-checkout-${info.project.name}`;
  const { item: { id: entry } } = await post("/_emdash/api/content/products", { slug, data: { title: "Trail maps" } });
  const count = 40;
  const label = (prefix: string) => `${prefix} ${"森林湖沼観察記録歩道案内登山保全地域資料".repeat(8)}`.slice(0, 160);
  const member = (i: number) => ({ commandId: `${slug}-${i}`, name: `Trail map ${i}`, sku: `${slug}-${i}`, fulfillment: "digital" });
  const choice = (i: number) => ({ valueId: `edition-${i}`, label: label(`Edition ${i}`) });
  const { catalogItemId: parent } = await catalog({ op: "create", entryId: entry, ...member(0) });
  let { product } = await catalog({ op: "option", productId: parent, optionId: "edition", optionLabel: label("Edition"),
    values: Array.from({ length: 8 }, (_, i) => ({ ...choice(i), member: i ? member(i) : { catalogItemId: parent, fulfillment: "digital" } })),
  });
  for (let i = 8; i < count; i++) {
    ({ product } = await catalog({ op: "option", productId: parent, expectedRevision: product.revision,
      ...member(i), selections: [{ optionId: "edition", ...choice(i) }] }));
  }
  for (const axis of ["finish", "format"]) {
    ({ product } = await catalog({ op: "option", productId: parent, expectedRevision: product.revision,
      optionId: axis, optionLabel: label(axis), values: [0, 1].map(i => ({ valueId: `${axis}-${i}`, label: label(`${axis} ${i}`) })),
      members: product.members.map((m: { catalogItemId: string }, i: number) => ({
        catalogItemId: m.catalogItemId, valueId: `${axis}-${(i >> (axis === "finish" ? 0 : 1)) & 1}`,
      })),
    }));
  }
  const ids = product.members.map((m: { catalogItemId: string }) => m.catalogItemId) as string[];
  expect(ids).toHaveLength(count);
  for (const id of ids) expect((await catalog({ op: "prices", productId: parent, catalogItemId: id,
    regular: id === ids[0] ? "12.50" : "0", sale: "", stockStatus: "in-stock" })).saved).toBe(true);
  await post(`/_emdash/api/content/products/${entry}/publish`, {});

  // A separate shopper cookie jar; maxRedirects: 0 keeps the test on the fixture host.
  const shopper = await browser.newContext({ baseURL: origin });
  const sessionCalls = () => readFileSync(`${stateFile}.calls.jsonl`, "utf8").trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(call => call.method === "POST" && call.path === "/v1/checkout/session").length;
  try {
    const headers = { Origin: origin };
    const added = await shopper.request.post("/cart/add", { headers, form: { id: ids[0]!, quantity: "1" }, maxRedirects: 0 });
    expect(added.status()).toBe(303);
    const { cart } = await (await shopper.request.get("/cart.js")).json();
    const saved = await shopper.request.post("/cart/update.js", { headers, data: { version: cart.version,
      lines: ids.map(catalogItemId => ({ catalogItemId, quantity: 1 })),
    } });
    expect((await saved.json()).cart.lines).toHaveLength(count);
    const before = sessionCalls();
    const checkout = await shopper.request.post("/checkout", { headers, maxRedirects: 0, form: {
      email: "checkout-fixture@example.test", "billing[name]": "Fixture Shopper", "billing[line1]": "1 Example Way",
      "billing[city]": "Springfield", "billing[region]": "IL", "billing[postalCode]": "62701", "billing[country]": "US",
    } });
    expect(sessionCalls()).toBe(before + 1);
    expect(checkout.status()).toBe(303);
    expect(checkout.headers().location).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_[A-Za-z0-9]+$/u);
  } finally {
    await shopper.close();
    await post(`/_emdash/api/content/products/${entry}/unpublish`, {});
  }
});
