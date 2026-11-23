import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { encryptPluginSetting } from "emdash";
import { pluginUniqueIndexName } from "../e2e/helpers/plugin-index";

// Check out saves what the shopper typed (template-cart-checkout-saves-quantities-20261123), with the real,
// enabled Check out button of a connected store: the cart page's one form posts every typed quantity to
// /cart/update, the store saves them in Commerce, then opens /checkout, as Shopify's Dawn and Horizon themes do.
// Only the two outside services Commerce calls are stood in for (tests/paired/helpers/dinkuskit-stand-in.mjs);
// Stripe is never reached, because the proof stops on the store's own checkout page.
const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const base = `/_emdash/api/plugins/${commerce}/`;
const headers = { "X-EmDash-Request": "1" };
const dbFile = process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db";
const out = process.env.DINKUS_PROOF_OUT ?? "test-results/cart-checkout-saves-quantities";
const stateFile = process.env.DINKUS_PAIRED_STAND_IN_STATE;

function sql<T>(run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbFile);
  try { return run(db); } finally { db.close(); }
}
const option = (name: string, value: unknown) => sql((db) => db.prepare("INSERT OR REPLACE INTO options (name, value, revision) VALUES (?, ?, ?)")
  .run(`plugin:${commerce}:settings:${name}`, JSON.stringify(value), crypto.randomUUID()));

test("Check out saves a typed quantity first: with script, with a save still running, and with script off", async ({ page, browser }, info) => {
  test.skip(!stateFile || !(globalThis as { __dinkusPairedStandIn?: boolean }).__dinkusPairedStandIn,
    "needs the DinkusKit stand-in: NODE_OPTIONS=--import tests/paired/helpers/dinkuskit-stand-in.mjs and DINKUS_PAIRED_STAND_IN_STATE");
  test.setTimeout(300_000);
  mkdirSync(out, { recursive: true });
  const setup = await page.request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.ok()).toBe(true);
  const origin = new URL(setup.url()).origin;
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  await expect.poll(() => sql((db) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(pluginUniqueIndexName(commerce, "catalog_items", "commandId"))), { timeout: 90_000 }).toEqual({ n: 1 });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const slug = `trail-mug-${info.project.name}`;
  const entry = (await post("/_emdash/api/content/products", { slug, data: { title: "Trail mug" } })).item.id;
  const id = (await post(base + "catalog", { op: "create", entryId: entry, commandId: slug, name: "Trail mug", sku: slug.toUpperCase(), fulfillment: "digital" })).catalogItemId;
  expect((await post(base + "catalog", { op: "prices", catalogItemId: id, regular: "9", sale: "", stockStatus: "in-stock" })).saved).toBe(true);
  await post(`/_emdash/api/content/products/${entry}/publish`, {});

  // Connected the way Connect leaves a store, so its Check out button is the real, enabled one.
  const state = { storeKey: `dk_store_${"q".repeat(43)}`, siteId: "paired-cart-form", bindingRef: "paired-cart-form-binding", stripeAccountId: "acct_1PairedCartForm", expired: [] as string[] };
  const settings = JSON.stringify({
    schema: "dinkuskit.commerce.registry-checkout/v1", enabled: true, commerceOrigin: origin, siteId: state.siteId,
    paymentsOrigin: "https://payments.dinkuskit.com", bindingRef: state.bindingRef, providerId: "stripe", stripeAccountId: state.stripeAccountId,
    mode: "test", pricingSchema: "dinkuskit.commerce.checkout-pricing/v1", issuer: "https://dinkuskit.com/account", audience: "dinkus-payments",
    shipping: { configurationId: "paired-cart-form-free", revision: 1, mode: "free" },
  });
  // Connected once per store: the phone run reuses the connection the desktop run made.
  const connected = sql((db) => db.prepare("SELECT 1 FROM options WHERE name = ?").get(`plugin:${commerce}:settings:installedCheckout`));
  if (!connected) {
    writeFileSync(stateFile!, JSON.stringify({ ...state, settings }, null, 2));
    writeFileSync(`${stateFile}.calls.jsonl`, "");
    option("connection", await encryptPluginSetting(commerce, "connection", JSON.stringify({ siteId: state.siteId, storeKey: state.storeKey })));
    option("installedCheckout", settings);
  }

  async function shopperWithMug(javaScriptEnabled: boolean): Promise<Page> {
    const context = await browser.newContext({ baseURL: origin, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, javaScriptEnabled, storageState: { cookies: [], origins: [] } });
    const tab = await context.newPage();
    expect((await tab.request.post("/cart/add", { form: { id, quantity: "1" }, headers: { origin } })).ok()).toBe(true);
    await tab.goto("/cart");
    if (javaScriptEnabled) await tab.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")]);
    await expect(tab.locator("[data-guest-cart-checkout]")).toBeEnabled({ timeout: 60_000 });
    return tab;
  }
  const savedQuantity = async (tab: Page) => (await (await tab.request.get("/cart.js")).json()).cart.lines[0]?.quantity;
  const onCheckout = async (tab: Page, quantity: number) => {
    await expect(tab).toHaveURL(/\/checkout$/u);
    await expect(tab.locator(`[data-guest-cart-line="${id}"] [data-guest-cart-line-quantity]`)).toHaveText(`Quantity ${quantity}`);
    await expect(tab.locator("[data-guest-cart-subtotal-amount]")).toHaveText(`$${9 * quantity}.00`);
    expect(await savedQuantity(tab)).toBe(quantity);
  };

  // 1. With script: the shopper types 3 and presses Check out without Update.
  const scripted = await shopperWithMug(true);
  await scripted.locator("[data-guest-cart-qty]").fill("3");
  await scripted.screenshot({ path: `${out}/${info.project.name}-1-typed-3-before-check-out.png`, fullPage: true });
  await scripted.locator("[data-guest-cart-checkout]").click();
  await onCheckout(scripted, 3);
  await scripted.screenshot({ path: `${out}/${info.project.name}-2-checkout-shows-3.png`, fullPage: true });

  // 2. With script, Check out pressed while an Update is still saving waits for that save, then goes.
  await scripted.goto("/cart");
  await scripted.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")]);
  const held = Promise.withResolvers<void>();
  await scripted.route("**/cart/update", async (route) => { await held.promise; await route.continue(); }, { times: 1 });
  await scripted.locator("[data-guest-cart-qty]").fill("2");
  await scripted.getByRole("button", { name: "Update" }).click();
  await expect(scripted.locator("[data-server-cart]")).toHaveAttribute("aria-busy", "true");
  await scripted.locator("[data-guest-cart-checkout]").click();
  await scripted.waitForTimeout(500);
  await expect(scripted).toHaveURL(/\/cart$/u);
  held.resolve();
  await onCheckout(scripted, 2);
  await scripted.context().close();

  // 3. Script off: one plain form post saves the typed 4 and opens checkout.
  const plain = await shopperWithMug(false);
  await plain.locator("[data-guest-cart-qty]").fill("4");
  await plain.locator("[data-guest-cart-checkout]").focus();
  await plain.keyboard.press("Enter");
  await onCheckout(plain, 4);
  await plain.screenshot({ path: `${out}/${info.project.name}-3-script-off-checkout-shows-4.png`, fullPage: true });
  await plain.context().close();
  await post(`/_emdash/api/content/products/${entry}/unpublish`, {});
});
