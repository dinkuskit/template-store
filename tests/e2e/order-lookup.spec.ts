import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";

import { COMMERCE_ID, openProductsList } from "./helpers/product-page";

const proofRoot = resolve("runs/order-lookup-20261122/browser");

test("the header's Track order link opens a plain order lookup form that keeps what was typed", async ({ page, request }, testInfo) => {
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });

  // The store's old Account address leads here until the Accounts plugin brings sign-in.
  const old = await request.get("/account", { maxRedirects: 0 });
  expect(old.status()).toBe(302);
  expect(old.headers().location).toBe("/track-order");

  await page.goto("/");
  const link = page.locator("[data-order-lookup-nav]");
  await expect(link).toHaveText("Track order");
  await link.click();
  await expect(page).toHaveURL(/\/track-order$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Track your order");
  await expect(page.locator("[data-order-lookup-nav]")).toHaveAttribute("aria-current", "page");
  // A server form: no script draws or sends it.
  const form = page.locator("[data-order-lookup-form]");
  await expect(form).toHaveAttribute("method", "post");
  await expect(form).toHaveAttribute("action", "/track-order");
  await page.screenshot({ path: resolve(root, "form.png"), fullPage: true });

  await page.getByLabel("Order number").fill("#999999");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByRole("button", { name: "Find order" }).click();
  const alert = page.locator("[data-order-lookup-error]");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toBeVisible();
  await expect(page.locator("[data-order-lookup-order]")).toHaveCount(0);
  await expect(page.getByLabel("Order number")).toHaveValue("#999999");
  await expect(page.getByLabel("Email")).toHaveValue("nobody@example.test");
  await page.screenshot({ path: resolve(root, "refused.png"), fullPage: true });
});

test("a lookup posted from another site never shows an order", async ({ request }) => {
  const response = await request.post("/track-order", {
    headers: { origin: "https://evil.example.test", "sec-fetch-site": "cross-site", "content-type": "application/x-www-form-urlencoded" },
    data: "orderNumber=1001&email=pat%40example.test",
    maxRedirects: 0,
  });
  expect(response.status()).not.toBe(200);
  expect(await response.text()).not.toContain("data-order-lookup-order");
});

// The Find order button is the page's one action: its label must read at body size in every preset and theme.
for (const preset of ["aizome", "forest", "cobalt"]) for (const theme of ["light", "dark"]) {
  test(`the Find order button is readable (${preset}, ${theme})`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([
      { name: "dinkus_preset", value: preset, url: baseURL! },
      { name: "dinkus_theme", value: theme, url: baseURL! },
    ]);
    expect((await page.goto("/track-order"))?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const button = page.getByRole("button", { name: "Find order" });
    const colors = await button.evaluate((el) => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = (value: number[]) => value.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const style = getComputedStyle(el);
      const ink = luminance(rgb(style.color)), paper = luminance(rgb(style.backgroundColor));
      return { color: style.color, background: style.backgroundColor, contrast: (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05) };
    });
    console.log(JSON.stringify({ preset, theme, width: page.viewportSize()!.width, ...colors }));
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    if (preset === "aizome" && theme === "dark") {
      const root = resolve(proofRoot, testInfo.project.name);
      await mkdir(root, { recursive: true });
      await page.screenshot({ path: resolve(root, "form-dark.png"), fullPage: true });
    }
  });
}

// Paid orders as Commerce's paid-order receiver stores them ({ paidOrder, emailKey, number, revision }), written into
// the installed Commerce's own storage (its Registry runtime id), so the page reads them through the real route.
const COMMERCE_RUNTIME_ID = COMMERCE_ID;
const usd = (minor: string) => ({ currency: "USD", minor });
function paidOrderRow(orderId: string, number: number, email: string, name: string) {
  return {
    number, revision: 1, emailKey: email.toLowerCase(),
    paidOrder: {
      schema: "dinkuskit.commerce.paid-order/v1", orderId, receiptId: `rcpt-${orderId}`, attemptId: `attempt-${orderId}`,
      paymentId: `pi_${orderId}`, paidAt: "2026-11-01T15:00:00.000Z", mode: "test",
      lines: [{ catalogItemId: "item-hat", quantity: 2, name: "Red hat", unitPrice: usd("1200") }], total: usd("2400"),
      contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
        contact: { email, phone: "555-0100", delivery: { name, line1: "1 Lookup Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" } } },
    },
  };
}

async function lookUp(page: Page, orderNumber: string, email: string) {
  await page.goto("/track-order");
  await page.getByLabel("Order number").fill(orderNumber);
  await page.getByLabel("Email").fill(email);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/track-order") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Find order" }).click(),
  ]);
  await page.waitForLoadState();
  return response.status();
}

test("the installed Commerce finds one order for its number and email, and limits guesses before showing it", async ({ browser, page }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  // The installed Commerce builds its storage indexes on a fresh store's first admin requests.
  const admin = await browser.newPage();
  await openProductsList(admin);
  await admin.close();
  expect(existsSync(".artifacts/e2e/content.db")).toBe(true);
  // One pair of orders per browser project, so desktop and mobile runs never share an order number or an email.
  const base = testInfo.project.name.includes("mobile") ? 7200 : 7100;
  const tag = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  const pat = { id: `ord-lookup-${tag}-pat`, number: base + 1, email: `pat.${tag}@example.test`, name: "Pat Shopper" };
  const sam = { id: `ord-lookup-${tag}-sam`, number: base + 2, email: `sam.${tag}@example.test`, name: "Sam Shopper" };
  const database = new Database(".artifacts/e2e/content.db");
  const columns = (database.prepare("PRAGMA table_info(_plugin_storage)").all() as { name: string }[]).map((c) => c.name);
  const now = new Date().toISOString();
  for (const order of [pat, sam]) {
    const row: Record<string, string> = { plugin_id: COMMERCE_RUNTIME_ID, collection: "orders", id: order.id,
      data: JSON.stringify(paidOrderRow(order.id, order.number, order.email, order.name)), created_at: now, updated_at: now,
      ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
    const keys = Object.keys(row).filter((key) => columns.includes(key));
    database.prepare(`INSERT INTO _plugin_storage (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]));
  }
  const trace: unknown[] = [];

  // 1. The right number (with its #) and the checkout email in other letter case: that one order.
  expect(await lookUp(page, `#${pat.number}`, pat.email.toUpperCase())).toBe(200);
  const order = page.locator("[data-order-lookup-order]");
  await expect(order).toBeVisible();
  await expect(order).toHaveAttribute("data-order-lookup-order", String(pat.number));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Order #${pat.number}`);
  await expect(page.locator("[data-order-lookup-status]")).toHaveAttribute("data-order-lookup-status", "processing");
  await expect(page.locator("[data-order-lookup-status]")).toContainText("Processing · Placed November 1, 2026");
  await expect(page.locator("[data-order-lookup-line]")).toHaveCount(1);
  await expect(page.locator("[data-order-lookup-line]")).toContainText("Red hat × 2");
  await expect(page.locator("[data-order-lookup-address]")).toContainText("Pat Shopper");
  await expect(page.locator("[data-order-lookup-address]")).toContainText("1 Lookup Way");
  expect(await page.content()).not.toContain("pi_");
  await page.screenshot({ path: resolve(root, "found.png"), fullPage: true });
  trace.push({ step: "right pair", orderNumber: `#${pat.number}`, email: pat.email.toUpperCase(), status: 200, shown: [await page.getByRole("heading", { level: 1 }).innerText(), ...(await order.innerText()).split("\n").filter(Boolean)] });

  // 2. The same number with another shopper's email: the one not-found answer, and nothing of the order.
  expect(await lookUp(page, String(pat.number), sam.email)).toBe(422);
  await expect(page.locator("[data-order-lookup-error]")).toHaveText("No order matches that order number and email. Check both and try again.");
  await expect(page.locator("[data-order-lookup-order]")).toHaveCount(0);
  expect(await page.content()).not.toContain("Pat Shopper");
  trace.push({ step: "same number, another email", orderNumber: String(pat.number), email: sam.email, status: 422 });

  // 3. Five wrong emails for Sam's number lock it: even Sam's own email is refused, before anything is shown.
  for (const guess of ["a", "b", "c", "d", "e"]) {
    const email = `${guess}.${tag}@example.test`;
    expect(await lookUp(page, String(sam.number), email)).toBe(422);
    trace.push({ step: "wrong guess", orderNumber: String(sam.number), email, status: 422 });
  }
  expect(await lookUp(page, String(sam.number), sam.email)).toBe(429);
  await expect(page.locator("[data-order-lookup-error]")).toHaveText("Too many tries. Try again in an hour.");
  await expect(page.locator("[data-order-lookup-order]")).toHaveCount(0);
  expect(await page.content()).not.toContain("Sam Shopper");
  await page.screenshot({ path: resolve(root, "limited.png"), fullPage: true });
  trace.push({ step: "right pair after 5 wrong tries", orderNumber: String(sam.number), email: sam.email, status: 429 });
  const guesses = (database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'order_lookup_guesses'").all(COMMERCE_RUNTIME_ID) as { data: string }[])
    .map((row) => JSON.parse(row.data) as { tries?: number });
  expect(guesses.some((row) => row.tries === 5)).toBe(true);
  database.close();
  await writeFile(resolve(root, "trace.json"), JSON.stringify({ commerce: "installed Registry build", trace }, null, 2));
  console.log(JSON.stringify({ project: testInfo.project.name, trace }));
});
