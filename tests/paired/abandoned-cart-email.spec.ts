import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pluginUniqueIndexName } from "../e2e/helpers/plugin-index";

// Proof for the abandoned cart email (commerce-abandoned-cart-email-20261122) on this store with the pinned
// Commerce's Registry build (v0.9.0-beta.5 is the first beta with it). The proof store has no Payments, so the shopper's
// checkout is written as Commerce's start leaves it once the payment expired unpaid (the shape is the unit
// tests' real record); everything after that is the real 5-minute check, EmDash's dev email, and the store.
const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const base = `/_emdash/api/plugins/${commerce}/`;
const headers = { "X-EmDash-Request": "1" };
const dbFile = process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db";
const out = process.env.DINKUS_PROOF_OUT ?? "test-results/abandoned-cart-email";
const email = "shopper@example.test";

function sql<T>(run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbFile);
  try { return run(db); } finally { db.close(); }
}
const row = (collection: string, id: string) => sql((db) => {
  const found = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?").get(commerce, collection, id) as { data: string } | undefined;
  return found ? JSON.parse(found.data) : null;
});

test("one email 10 hours after an unpaid checkout, its link opens the cart, and its stop link stops them", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run makes the proof; the phone views are taken inside it");
  test.setTimeout(420_000);
  mkdirSync(out, { recursive: true });
  const setup = await page.request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.ok()).toBe(true);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  await expect.poll(() => sql((db) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(pluginUniqueIndexName(commerce, "catalog_items", "commandId"))), { timeout: 90_000 }).toEqual({ n: 1 });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const entry = (await post("/_emdash/api/content/products", { slug: "trail-mug", data: { title: "Trail mug" } })).item.id;
  const id = (await post(base + "catalog", { op: "create", entryId: entry, commandId: "trail-mug", name: "Trail mug", sku: "TRAIL-MUG", fulfillment: "digital" })).catalogItemId;
  expect((await post(base + "catalog", { op: "prices", catalogItemId: id, regular: "12", sale: "", stockStatus: "in-stock" })).saved).toBe(true);
  await post(`/_emdash/api/content/products/${entry}/publish`, {});

  // The owner's choice, on Commerce settings.
  await page.goto(`/_emdash/admin/plugins/${commerce}/settings`);
  await expect(page.getByText("Abandoned cart email")).toBeVisible({ timeout: 60_000 });
  const welcome = page.getByRole("button", { name: "Get Started" });
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await expect(welcome).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.getByText("Shoppers who ticked the box")).toBeVisible();
  await page.getByText("Abandoned cart email").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/settings-abandoned-cart-email.png` });

  const origin = new URL(setup.url()).origin;
  const fresh = (viewport = info.project.use.viewport, phone = false) => browser.newContext({ baseURL: origin, viewport, isMobile: phone, hasTouch: phone, storageState: { cookies: [], origins: [] } });
  const shopperContext = await fresh();
  const shopper = await shopperContext.newPage();
  await shopper.goto("/products/trail-mug");
  await shopper.locator("[data-add-to-cart]").click();
  await expect(shopper.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
  await shopper.goto("/checkout");
  const box = shopper.locator("[data-guest-cart-news]");
  await expect(box).not.toBeChecked();
  await expect(shopper.getByText("Email me with news and offers")).toBeVisible();
  await shopper.locator("[data-guest-cart-contact]").screenshot({ path: `${out}/checkout-news-box.png` });

  const key = (await shopperContext.cookies()).find((cookie) => cookie.name === "dk_cart")!.value;
  // The checkout Commerce's start saves with the tick, once its payment expired unpaid.
  const cartId = row("checkout_guest_capabilities", key.split(".")[0]!).cartId as string;
  const saved = row("checkout_carts", cartId);
  expect(saved.cart.lines).toEqual([{ catalogItemId: id, quantity: 1 }]);
  const attemptId = crypto.randomUUID();
  const attempt = {
    attemptId, cart: [{ catalogItemId: id, quantity: 1 }],
    contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", contact: { email, billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Billtown", postalCode: "00009", country: "US" } }, requirePhoneNumber: false, revision: null },
    payment: { attemptId, bindingRef: "stripe-test-binding", lines: [{ catalogItemId: id, quantity: 1, name: "Trail mug", unitPrice: { currency: "USD", minor: "1200" } }], total: { currency: "USD", minor: "1200" }, paymentWindow: { minSeconds: 1800, maxSeconds: 1860 }, paymentMethods: ["card"] },
    phase: "released",
    session: { sessionId: "session-" + attemptId, redirectUrl: "https://checkout.stripe.com/test", createdAt: 1, expiresAt: 1801 },
    paymentReleaseReason: "expired-unpaid",
  };
  // 10 hours and a minute ago, as the start set remindAt.
  const remindAt = String(Math.floor(Date.now() / 1000) - 60);
  sql((db) => db.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
    .run(JSON.stringify({ ...saved, attempts: [attempt], news: true, remindAt }), commerce, "checkout_carts", cartId));

  // The 5-minute check, run now instead of waiting for its turn.
  expect((await page.request.delete("/_emdash/api/dev/emails", { headers })).ok()).toBe(true);
  sql((db) => db.prepare("UPDATE _emdash_cron_tasks SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE plugin_id = ?").run(commerce));
  let mail: { message: { to: string; subject: string; text: string }; source: string } | undefined;
  await expect.poll(async () => {
    const items = (await (await page.request.get("/_emdash/api/dev/emails")).json()).data.items as (typeof mail)[];
    mail = items.find((item) => item!.message.subject.startsWith("You left something"));
    if (!mail) sql((db) => db.prepare("UPDATE _emdash_cron_tasks SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE plugin_id = ? AND status = 'idle'").run(commerce));
    return Boolean(mail);
  }, { timeout: 300_000, intervals: [5_000] }).toBe(true);
  expect(mail!.message.to).toBe(email);
  // EmDash reads the site's name when it starts; this proof store started before it had one, so the email names its host.
  expect(mail!.message.subject).toBe(`You left something in your cart at ${new URL(origin).host}`);
  expect(mail!.message.text).toContain("1 x Trail mug");
  const after = row("checkout_carts", cartId);
  expect(after.emailed).toBe(true);
  expect(after.remindAt).toBeUndefined();
  const link = /Your cart is saved: (\S+)/u.exec(mail!.message.text)![1]!;
  const stopLink = /To stop cart reminder emails: (\S+)/u.exec(mail!.message.text)![1]!;
  expect(link.startsWith(origin + "/cart/c/")).toBe(true);
  expect(stopLink).toBe(link + "&stop=1");
  const mailPage = await (await fresh({ width: 760, height: 520 })).newPage();
  const escape = (text: string) => text.replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  await mailPage.setContent(`<body style="font:16px/1.5 system-ui;margin:24px"><p><b>From</b> ${escape(mail!.source)} (EmDash dev email)<br><b>To</b> ${escape(mail!.message.to)}<br><b>Subject</b> ${escape(mail!.message.subject)}</p><pre style="white-space:pre-wrap;font:15px/1.5 ui-monospace,monospace;background:#f5f3ee;padding:16px;border-radius:8px">${escape(mail!.message.text)}</pre></body>`);
  await mailPage.screenshot({ path: `${out}/abandoned-cart-email.png`, fullPage: true });

  // The link, on another device: the same cart opens.
  for (const [name, phone] of [["desktop", false], ["phone", true]] as const) {
    const other = await fresh(phone ? { width: 412, height: 915 } : info.project.use.viewport, phone);
    const tab = await other.newPage();
    await tab.goto(link);
    await expect(tab).toHaveURL(/\/cart$/u);
    await expect(tab.locator(`[data-guest-cart-line="${id}"]`)).toBeVisible();
    await expect(tab.locator(`[data-guest-cart-line="${id}"] h2`)).toHaveText("Trail mug");
    await tab.screenshot({ path: `${out}/link-opens-cart-${name}.png`, fullPage: !phone });
    expect((await other.cookies()).find((cookie) => cookie.name === "dk_cart")!.value).not.toBe(key);
    await other.close();
  }

  // A link Commerce refuses (a made-up or revoked key) opens the cart page and leaves this browser's cart alone.
  const guessContext = await fresh();
  await guessContext.addCookies([{ name: "dk_cart", value: key, url: origin }, { name: "dk_cart_count", value: "1", url: origin }]);
  const guess = await guessContext.newPage();
  await guess.goto(`/cart/c/${link.split("/cart/c/")[1]!.split("?")[0]}?key=${"0".repeat(64)}&stop=1`);
  await expect(guess).toHaveURL(/\/cart$/u);
  expect((await guessContext.cookies()).find((cookie) => cookie.name === "dk_cart")!.value).toBe(key);
  await guessContext.close();
  // This shopper's stop (other paired proofs keep their own shoppers' stops).
  const stopId = createHash("sha256").update(email).digest("hex");
  const stopCount = () => sql((db) => db.prepare("SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection = 'cart_email_stops' AND id = ?").get(commerce, stopId));

  // The shopper tries the same cart again with another email, which also ends unpaid. The stop link still stops
  // the address the email went to, not the latest checkout's.
  const retryId = crypto.randomUUID();
  const retry = { ...attempt, attemptId: retryId, payment: { ...attempt.payment, attemptId: retryId },
    contactSnapshot: { ...attempt.contactSnapshot, contact: { ...attempt.contactSnapshot.contact, email: "other-shopper@example.test" } } };
  const emailedRecord = row("checkout_carts", cartId);
  sql((db) => db.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
    .run(JSON.stringify({ ...emailedRecord, attempts: [attempt, retry] }), commerce, "checkout_carts", cartId));

  // The stop link asks first, naming the cart its link opened.
  const stopperContext = await fresh();
  const stopper = await stopperContext.newPage();
  const linkId = link.split("/cart/c/")[1]!.split("?")[0]!;
  await stopper.goto(stopLink);
  await expect(stopper).toHaveURL(new RegExp(`/cart\\?stop=${linkId}$`, "u"));
  await expect(stopper.getByText("Stop cart reminder emails from this store?")).toBeVisible();
  await stopper.screenshot({ path: `${out}/stop-link-asks.png` });
  // Another link opened in a second tab replaces this browser's cart: the first tab's confirmation stops nothing.
  const second = await stopperContext.newPage();
  await second.goto(`/cart/c/${key.split(".")[0]}?key=${key.split(".")[1]}`);
  await expect(second).toHaveURL(/\/cart$/u);
  await stopper.getByRole("button", { name: "Stop emails" }).click();
  await expect(stopper).toHaveURL(/cart_error=STOP_LINK$/u);
  await expect(stopper.getByText("Nothing was stopped: this browser now holds a different cart. Open the stop link in the email again.")).toBeVisible();
  await stopper.screenshot({ path: `${out}/stop-link-changed-cart.png` });
  expect(stopCount()).toEqual({ n: 0 });
  // A stop link accepted while the cart lived, confirmed only after the cart's 30 days: Commerce refuses the key
  // at the stop itself, so nothing is stopped.
  const writeCart = (record: unknown) => sql((db) => db.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
    .run(JSON.stringify(record), commerce, "checkout_carts", cartId));
  const live = row("checkout_carts", cartId);
  await stopper.goto(stopLink);
  await expect(stopper.getByText("Stop cart reminder emails from this store?")).toBeVisible();
  writeCart({ ...live, cartExpires: String(Math.floor(Date.now() / 1000) - 1) });
  await stopper.getByRole("button", { name: "Stop emails" }).click();
  await expect(stopper).toHaveURL(/cart_error=STOP_EXPIRED$/u);
  await expect(stopper.getByText("That link has expired, so cart reminder emails could not be stopped here.", { exact: false })).toBeVisible();
  await stopper.screenshot({ path: `${out}/stop-after-cart-expired.png` });
  expect(stopCount()).toEqual({ n: 0 });
  writeCart(live);
  await stopper.goto(stopLink);
  await stopper.getByRole("button", { name: "Stop emails" }).click();
  await expect(stopper).toHaveURL(/\/cart\?stopped=1$/u);
  await expect(stopper.getByText("Done. You won't get cart reminder emails from this store again.")).toBeVisible();
  await stopper.screenshot({ path: `${out}/stop-link-done.png` });
  expect(row("cart_email_stops", stopId)).toMatchObject({ at: expect.stringMatching(/^\d+$/u) });
  expect(stopCount()).toEqual({ n: 1 });
  await stopperContext.close();

  // Past the cart's 30 days the email's link opens nothing: this browser gets no cart key and an empty cart.
  sql((db) => db.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
    .run(JSON.stringify({ ...row("checkout_carts", cartId), cartExpires: String(Math.floor(Date.now() / 1000) - 1) }), commerce, "checkout_carts", cartId));
  const lateContext = await fresh();
  const late = await lateContext.newPage();
  await late.goto(link);
  await expect(late).toHaveURL(/\/cart$/u);
  await expect(late.locator(`[data-guest-cart-line="${id}"]`)).toHaveCount(0);
  expect((await lateContext.cookies()).find((cookie) => cookie.name === "dk_cart")).toBeUndefined();
  await late.screenshot({ path: `${out}/link-after-cart-expired.png` });
  await lateContext.close();

  // The 5-minute cleanup deletes the expired cart; the shopper's own browser then fills a new cart under the same
  // id. The old email link still opens nothing: it never reaches the new cart.
  sql((db) => db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = 'checkout_carts' AND id = ?").run(commerce, cartId));
  await shopper.goto("/products/trail-mug");
  await shopper.locator("[data-add-to-cart]").click();
  await expect(shopper.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
  expect(row("checkout_carts", cartId).cart.lines).toEqual([{ catalogItemId: id, quantity: 1 }]);
  const replayContext = await fresh();
  const replay = await replayContext.newPage();
  await replay.goto(link);
  await expect(replay).toHaveURL(/\/cart$/u);
  await expect(replay.locator(`[data-guest-cart-line="${id}"]`)).toHaveCount(0);
  expect((await replayContext.cookies()).find((cookie) => cookie.name === "dk_cart")).toBeUndefined();
  await replay.screenshot({ path: `${out}/link-after-cart-made-again.png` });
  await replayContext.close();
  await shopperContext.close();
  // Nothing stays on sale for the other paired proofs.
  await post(`/_emdash/api/content/products/${entry}/unpublish`, {});
  await expect.poll(async () => ((await (await page.request.get(base + "catalog/public")).json()).data.products as { name: string }[]).map((item) => item.name)).not.toContain("Trail mug");
});
