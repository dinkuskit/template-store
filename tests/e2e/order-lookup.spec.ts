import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

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
