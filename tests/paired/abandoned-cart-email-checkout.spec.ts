import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { encryptPluginSetting } from "emdash";
import { pluginUniqueIndexName } from "../e2e/helpers/plugin-index";

// The abandoned cart email (commerce-abandoned-cart-email-20261122) from the shopper's own checkout form to the
// email's send or refusal, on this store with the pinned Commerce's Registry build. Every step a shopper takes
// is the real one: the product page's add button, the store's /checkout form with the "Email me with news and
// offers" box ticked or left alone, Commerce's checkout start, its 5-minute check (EmDash's own scheduler) and
// EmDash's dev email. Only the two outside services Commerce calls are stood in for, by
// tests/paired/helpers/dinkuskit-stand-in.mjs loaded into the store's process: DinkusKit.com hands out the
// store's 5-minute passes, and Payments opens a Stripe test session, later reports it expired unpaid and wakes
// Commerce about it, as Payments does once Stripe's 30 minutes pass. The store is connected the way Connect
// leaves it: the encrypted connection setting and the checkout settings DinkusKit.com hands over.
const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const base = `/_emdash/api/plugins/${commerce}/`;
const headers = { "X-EmDash-Request": "1" };
const dbFile = process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db";
const out = process.env.DINKUS_PROOF_OUT ?? "test-results/abandoned-cart-email";
const stateFile = process.env.DINKUS_PAIRED_STAND_IN_STATE;
const STRIPE = "https://checkout.stripe.com/";
const ticked = "ticked-shopper@example.test";
const unticked = "unticked-shopper@example.test";

function sql<T>(run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbFile);
  try { return run(db); } finally { db.close(); }
}
const row = (collection: string, id: string) => sql((db) => {
  const found = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?").get(commerce, collection, id) as { data: string } | undefined;
  return found ? JSON.parse(found.data) : null;
});
const patchCart = (id: string, patch: Record<string, unknown>) => sql((db) => db.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = 'checkout_carts' AND id = ?")
  .run(JSON.stringify({ ...row("checkout_carts", id), ...patch }), commerce, id));
const option = (name: string, value: unknown) => sql((db) => db.prepare("INSERT OR REPLACE INTO options (name, value, revision) VALUES (?, ?, ?)")
  .run(`plugin:${commerce}:settings:${name}`, JSON.stringify(value), crypto.randomUUID()));
const now = () => Math.floor(Date.now() / 1000);

test("the checkout box decides the email: ticked gets one, unticked none, and a stop ends one still waiting", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run makes the proof");
  test.skip(!stateFile || !(globalThis as { __dinkusPairedStandIn?: boolean }).__dinkusPairedStandIn,
    "needs the DinkusKit stand-in: NODE_OPTIONS=--import tests/paired/helpers/dinkuskit-stand-in.mjs and DINKUS_PAIRED_STAND_IN_STATE");
  test.setTimeout(600_000);
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
  const entry = (await post("/_emdash/api/content/products", { slug: "camp-mug", data: { title: "Camp mug" } })).item.id;
  const id = (await post(base + "catalog", { op: "create", entryId: entry, commandId: "camp-mug", name: "Camp mug", sku: "CAMP-MUG", fulfillment: "digital" })).catalogItemId;
  expect((await post(base + "catalog", { op: "prices", catalogItemId: id, regular: "9", sale: "", stockStatus: "in-stock" })).saved).toBe(true);
  await post(`/_emdash/api/content/products/${entry}/publish`, {});

  // Connected: the store key and Store ID Connect saves (encrypted, as EmDash keeps a secret setting), and the
  // Stripe test checkout settings DinkusKit.com hands Commerce. The setting stays at its default, Shoppers who
  // ticked the box.
  const state = { storeKey: `dk_store_${"p".repeat(43)}`, siteId: "paired-proof", bindingRef: "paired-proof-binding", stripeAccountId: "acct_1PairedProof", expired: [] as string[] };
  const settings = JSON.stringify({
    schema: "dinkuskit.commerce.registry-checkout/v1", enabled: true, commerceOrigin: origin, siteId: state.siteId,
    paymentsOrigin: "https://payments.dinkuskit.com", bindingRef: state.bindingRef, providerId: "stripe", stripeAccountId: state.stripeAccountId,
    mode: "test", pricingSchema: "dinkuskit.commerce.checkout-pricing/v1", issuer: "https://dinkuskit.com/account", audience: "dinkus-payments",
    shipping: { configurationId: "paired-proof-free", revision: 1, mode: "free" },
  });
  writeFileSync(stateFile!, JSON.stringify({ ...state, settings }, null, 2));
  writeFileSync(`${stateFile}.calls.jsonl`, "");
  option("connection", await encryptPluginSetting(commerce, "connection", JSON.stringify({ siteId: state.siteId, storeKey: state.storeKey })));
  option("installedCheckout", settings);

  const contexts: BrowserContext[] = [];
  const fresh = async () => {
    const context = await browser.newContext({ baseURL: origin, viewport: info.project.use.viewport, storageState: { cookies: [], origins: [] } });
    contexts.push(context);
    // Stripe's page is not part of this proof and is never opened: the store's answer to the checkout form is
    // read as it comes back, and the browser stops at the Stripe address it names.
    await context.route((url) => url.origin === origin && url.pathname === "/checkout", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const answer = await route.fetch({ maxRedirects: 0 });
      const location = answer.headers()["location"] ?? "";
      if (answer.status() !== 303 || !location.startsWith(STRIPE)) return route.fulfill({ response: answer });
      const cookie = answer.headers()["set-cookie"];
      return route.fulfill({ status: 200, contentType: "text/html", ...(cookie ? { headers: { "set-cookie": cookie } } : {}),
        body: `<body style="font:16px/1.5 system-ui;margin:24px"><h1 style="font-size:20px">The store sent the shopper to Stripe</h1><p>HTTP ${answer.status()} to <code data-stripe>${location}</code></p><p>The shopper leaves without paying.</p></body>` });
    });
    return context;
  };
  const record = (tab: Page) => tab.context().cookies().then((cookies) => {
    const key = cookies.find((cookie) => cookie.name === "dk_cart")!.value;
    return row("checkout_guest_capabilities", key.split(".")[0]!).cartId as string;
  });
  /** One shopper: the product page's add button, then the store's checkout form, sent to Stripe. */
  async function checkout(email: string, news: boolean, shot?: string) {
    const tab = await (await fresh()).newPage();
    await tab.goto("/products/camp-mug");
    await tab.locator("[data-add-to-cart]").click();
    await expect(tab.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
    await tab.goto("/checkout");
    await expect(tab.locator("[data-guest-cart-checkout]")).toBeEnabled({ timeout: 60_000 });
    await tab.locator("[data-guest-cart-email]").fill(email);
    if (news) await tab.locator("[data-guest-cart-news]").check();
    await expect(tab.locator("[data-guest-cart-news]")).toBeChecked({ checked: news });
    await tab.locator("[data-guest-cart-billing-name]").fill("Pat Shopper");
    await tab.locator("[data-guest-cart-billing-line1]").fill("1 Proof Way");
    await tab.locator("[data-guest-cart-billing-city]").fill("Springfield");
    await tab.locator("[data-guest-cart-billing-region]").fill("IL");
    await tab.locator("[data-guest-cart-billing-postal-code]").fill("62701");
    await tab.locator("[data-guest-cart-billing-country]").selectOption("US");
    if (shot) await tab.locator("[data-guest-cart-contact]").screenshot({ path: `${out}/${shot}` });
    await tab.locator("[data-guest-cart-checkout]").click();
    await expect(tab.locator("[data-stripe]")).toHaveText(new RegExp(`^${STRIPE}c/pay/cs_test_`, "u"));
    const cartId = await record(tab);
    const saved = row("checkout_carts", cartId);
    const attempt = saved.attempts.at(-1);
    return { tab, cartId, attemptId: attempt.attemptId as string, saved, attempt };
  }

  const shopperA = await checkout(ticked, true, "checkout-box-ticked.png");
  await shopperA.tab.screenshot({ path: `${out}/checkout-sent-to-stripe.png` });
  const shopperU = await checkout(unticked, false, "checkout-box-unticked.png");
  // A second checkout by the ticked shopper, from another browser: its email waits 10 hours like the first.
  const shopperB = await checkout(ticked, true);
  const started = now();
  for (const [shopper, news, email] of [[shopperA, true, ticked], [shopperU, false, unticked], [shopperB, true, ticked]] as const) {
    // Commerce's start kept the box as the shopper left it and set the email for 10 hours on.
    expect(shopper.saved.news).toBe(news ? true : undefined);
    expect(+shopper.saved.remindAt).toBeGreaterThan(started + 36_000 - 300);
    expect(+shopper.saved.remindAt).toBeLessThanOrEqual(started + 36_000);
    expect(shopper.attempt.contactSnapshot.contact.email).toBe(email);
    expect(shopper.attempt.phase).not.toBe("released");
  }

  // Stripe's 30 minutes pass for all three: Payments now reports each session expired unpaid and wakes Commerce.
  writeFileSync(stateFile!, JSON.stringify({ ...JSON.parse(readFileSync(stateFile!, "utf8")), expired: [shopperA.attemptId, shopperU.attemptId, shopperB.attemptId] }, null, 2));
  expect((await page.request.delete("/_emdash/api/dev/emails", { headers })).ok()).toBe(true);
  const emails = async () => (await (await page.request.get("/_emdash/api/dev/emails")).json()).data.items as { message: { to: string; subject: string; text: string }; source: string }[];
  const force = () => sql((db) => db.prepare("UPDATE _emdash_cron_tasks SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE plugin_id = ? AND status = 'idle'").run(commerce));
  /** Runs the 5-minute check until each named cart's email is decided; a check that still saw an open checkout is run again. */
  async function decide(...cartIds: string[]) {
    for (const cartId of cartIds) patchCart(cartId, { remindAt: String(now() - 60) });
    force();
    await expect.poll(() => {
      const waiting = cartIds.filter((cartId) => row("checkout_carts", cartId).remindAt !== undefined);
      for (const cartId of waiting) if (+row("checkout_carts", cartId).remindAt > now()) patchCart(cartId, { remindAt: String(now() - 60) });
      if (waiting.length) force();
      return waiting.length;
    }, { timeout: 300_000, intervals: [5_000] }).toBe(0);
  }

  // 10 hours on for the first ticked checkout and the unticked one: one email, to the shopper who ticked the box.
  await decide(shopperA.cartId, shopperU.cartId);
  await expect.poll(async () => (await emails()).length, { timeout: 30_000 }).toBe(1);
  const [mail] = await emails();
  expect(mail!.message.to).toBe(ticked);
  expect(mail!.message.text).toContain("1 x Camp mug");
  expect(row("checkout_carts", shopperA.cartId)).toMatchObject({ emailed: true, attempts: [{ phase: "released", paymentReleaseReason: "expired-unpaid" }] });
  expect(row("checkout_carts", shopperU.cartId).emailed).toBeUndefined();
  expect(row("checkout_carts", shopperU.cartId).attempts.at(-1).phase).toBe("released");
  const mailPage = await (await fresh()).newPage();
  const escape = (text: string) => text.replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  await mailPage.setContent(`<body style="font:16px/1.5 system-ui;margin:24px"><p><b>From</b> ${escape(mail!.source)} (EmDash dev email)<br><b>To</b> ${escape(mail!.message.to)}<br><b>Subject</b> ${escape(mail!.message.subject)}</p><pre style="white-space:pre-wrap;font:15px/1.5 ui-monospace,monospace;background:#f5f3ee;padding:16px;border-radius:8px">${escape(mail!.message.text)}</pre></body>`);
  await mailPage.screenshot({ path: `${out}/checkout-email-ticked.png`, fullPage: true });

  // The ticked shopper stops cart emails from that email's stop link, while their second checkout's email still waits.
  const stopLink = /To stop cart reminder emails: (\S+)/u.exec(mail!.message.text)![1]!;
  expect(row("checkout_carts", shopperB.cartId).remindAt).toBeDefined();
  const stopper = await (await fresh()).newPage();
  await stopper.goto(stopLink);
  await stopper.getByRole("button", { name: "Stop emails" }).click();
  await expect(stopper.getByText("Done. You won't get cart reminder emails from this store again.")).toBeVisible();
  expect(row("cart_email_stops", createHash("sha256").update(ticked).digest("hex"))).toMatchObject({ at: expect.stringMatching(/^\d+$/u) });

  // 10 hours on for that waiting checkout: the check sees the stop and sends nothing.
  await decide(shopperB.cartId);
  await page.waitForTimeout(3_000);
  expect((await emails()).length).toBe(1);
  expect(row("checkout_carts", shopperB.cartId).emailed).toBeUndefined();
  expect(row("checkout_carts", shopperB.cartId).attempts.at(-1).phase).toBe("released");

  const calls = readFileSync(`${stateFile}.calls.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const outcome = [
    { shopper: "ticked the box", email: ticked, emailed: Boolean(row("checkout_carts", shopperA.cartId).emailed) },
    { shopper: "left the box alone", email: unticked, emailed: Boolean(row("checkout_carts", shopperU.cartId).emailed) },
    { shopper: "ticked the box, then stopped emails before this one was due", email: ticked, emailed: Boolean(row("checkout_carts", shopperB.cartId).emailed) },
  ];
  writeFileSync(`${out}/checkout-trace.json`, JSON.stringify({ outcome, emails: (await emails()).map((item) => ({ to: item.message.to, subject: item.message.subject })),
    payments: calls.map(({ host, method, path, attemptId, outcome: result, wakes, scope }) => ({ host, method, path, attemptId, outcome: result, wakes, scope })) }, null, 2));
  const summary = await (await fresh()).newPage();
  await summary.setContent(`<body style="font:16px/1.5 system-ui;margin:24px"><h1 style="font-size:20px">Three real checkouts, each left unpaid</h1><table style="border-collapse:collapse">${
    outcome.map((line) => `<tr><td style="padding:6px 12px;border:1px solid #ccc">${escape(line.shopper)}</td><td style="padding:6px 12px;border:1px solid #ccc">${escape(line.email)}</td><td style="padding:6px 12px;border:1px solid #ccc"><b>${line.emailed ? "cart email sent" : "no email"}</b></td></tr>`).join("")
  }</table><p>EmDash dev email holds ${(await emails()).length} message(s).</p></body>`);
  await summary.screenshot({ path: `${out}/checkout-outcomes.png` });
  expect(outcome.map((line) => line.emailed)).toEqual([true, false, false]);

  // The store goes back to unconnected, with nothing on sale, for the other paired proofs.
  await post(`/_emdash/api/content/products/${entry}/unpublish`, {});
  await expect.poll(async () => ((await (await page.request.get(base + "catalog/public")).json()).data.products as { name: string }[]).map((item) => item.name)).not.toContain("Camp mug");
  sql((db) => db.prepare("DELETE FROM options WHERE name IN (?, ?)").run(`plugin:${commerce}:settings:connection`, `plugin:${commerce}:settings:installedCheckout`));
  if (existsSync(stateFile!)) writeFileSync(stateFile!, "{}");
  for (const context of contexts) await context.close();
});
