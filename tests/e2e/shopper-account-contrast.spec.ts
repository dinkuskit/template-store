import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { SHOPPER_SESSION_STORAGE_KEY } from "../../src/features/shopper-account/index.js";

// Consumer/paint proof only: every account response is synthetic. No OTP, mail,
// real session, profile, order or fulfillment operation is created or changed.
async function contrastSamples(root: Locator) {
  return root.locator("h1, h2, h3, p, label, input, select, button, code, strong, .account-order-line__main, .account-order-card__badge, .account-order-line__badge, .account-order-line__thumb-fallback").evaluateAll(elements => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const over = (top: number[], bottom: number[]) => top.slice(0, 3).map((v, i) => v * top[3] / 255 + bottom[i]! * (1 - top[3] / 255));
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => {
      const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    return elements.filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden").map(el => {
      const layers: number[][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
      let paper = [255, 255, 255];
      for (const layer of layers.reverse()) paper = over(layer, paper);
      const ink = luminance(over(rgba(getComputedStyle(el).color), paper));
      const bg = luminance(paper);
      return { tag: el.tagName, text: el instanceof HTMLInputElement ? el.value : el.textContent?.trim().slice(0, 60), ratio: (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05) };
    });
  });
}

for (const preset of ["aizome", "forest", "cobalt"]) for (const theme of ["light", "dark", ...(preset === "aizome" ? ["system"] : [])]) {
  test(`account text stays readable (${preset}, ${theme})`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([
      { name: "dinkus_preset", value: preset, url: baseURL! },
      { name: "dinkus_theme", value: theme, url: baseURL! },
    ]);
    const email = "synthetic@example.test";
    const profile = { email, phone: "+15555550123", delivery: { name: "Synthetic Shopper", line1: "1 Test Way", line2: "", city: "Testville", region: "NC", postalCode: "27601", country: "US" } };
    const order = { orderId: "ord_synthetic_contrast", receiptId: "rcpt_synthetic_contrast", number: 1001, status: "processing", paidAt: "2026-11-01T12:00:00.000Z", total: { currency: "USD", minor: "1200" }, lines: [{ catalogItemId: "synthetic-notebook", name: "Synthetic notebook", quantity: 1, unitPrice: { currency: "USD", minor: "1200" } }], choices: [], delivery: profile.delivery, phone: profile.phone };
    let unexpectedWrites = 0;
    await context.route("**/*", route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith("/account/orders")) return route.fulfill({ json: { success: true, data: { ok: true, profile, orders: [order] } } });
      if (path.includes("/api/guest-cart/snapshot")) return route.fulfill({ json: { products: [{ id: "synthetic-notebook", found: true, name: "Synthetic notebook", sku: "SYNTHETIC-NOTEBOOK", fulfillment: "physical", thumbnail: null }] } });
      if (request.method() === "POST" && path.endsWith("/account/sign-in/start")) return route.fulfill({ json: { success: true, data: { ok: true } } });
      if (request.method() === "POST" && path.endsWith("/account/sign-in/verify")) return route.fulfill({ json: { success: true, data: { ok: false, error: { code: "CODE_INVALID", message: "Synthetic provider refusal" } } } });
      if (request.method() === "POST" && path.endsWith("/account/profile")) return route.fulfill({ json: { success: true, data: { ok: true, profile } } });
      if (request.method() === "POST" && path.endsWith("/account/sign-out")) return route.fulfill({ json: { success: true, data: { ok: true } } });
      if (!["GET", "HEAD"].includes(request.method())) { unexpectedWrites++; return route.abort(); }
      return route.continue();
    });
    if (theme === "system") await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/account");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-preset", preset);
    await page.locator("[data-account-email]").fill(email);
    await page.locator("[data-account-start]").click();
    const code = page.locator("[data-account-code]");
    await expect(code).toBeFocused();
    await code.fill("123456");
    const root = page.locator("[data-shopper-account]");
    await expect(page.locator(".account-card--stamp").first()).toHaveCSS("background-color", "rgb(252, 251, 248)");
    const samples = [...await contrastSamples(root)];
    const proof = process.env.DINKUS_ACCOUNT_CONTRAST_CAPTURES;
    const capture = async (state: string) => {
      if (!proof || preset !== "aizome" || theme !== "dark") return;
      const width = page.viewportSize()!.width;
      if ((width >= 1000 && state !== "signed-out") || (width < 1000 && state !== "signed-in")) return;
      await mkdir(proof, { recursive: true });
      await page.screenshot({ path: resolve(proof, `${process.env.DINKUS_ACCOUNT_CONTRAST_PHASE ?? "after"}-${width}.png`) });
    };
    await capture("signed-out");
    await page.locator("[data-account-verify]").click();
    await expect(page.locator("[data-account-status]")).toHaveText("Synthetic provider refusal");
    samples.push(...await contrastSamples(root));
    await page.evaluate(({ key, email }) => localStorage.setItem(key, JSON.stringify({ sessionId: "csess_synthetic_contrast", sessionToken: "csess_synthetic_contrast.0123456789abcdef0123456789abcdef", email, expiresAt: 4_102_444_800 })), { key: SHOPPER_SESSION_STORAGE_KEY, email });
    await page.reload();
    await expect(page.locator("[data-account-signed-in]")).toBeVisible();
    await expect(page.locator(".account-session-bar")).toHaveCSS("background-color", "rgb(27, 42, 74)");
    await expect(page.locator("[data-account-order-line-sku]")).toHaveText("SKU: SYNTHETIC-NOTEBOOK");
    await expect(page.locator("[data-account-profile-name]")).toHaveValue(profile.delivery.name);
    await capture("signed-in");
    samples.push(...await contrastSamples(root));
    await page.locator("[data-account-profile-save]").click();
    await expect(page.locator("[data-account-status]")).toContainText("Saved your default shipping address");
    samples.push(...await contrastSamples(root));
    await page.locator("[data-account-signout]").click();
    await expect(page.locator("[data-account-signed-out]")).toBeVisible();
    expect(unexpectedWrites).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(samples.length).toBeGreaterThan(40);
    // Attach compact public-safe numeric output; no capability or response dump.
    await testInfo.attach("painted-contrast", { body: JSON.stringify(samples), contentType: "application/json" });
    console.log(JSON.stringify({ preset, theme, width: page.viewportSize()!.width, samples: samples.length, minimumContrast: Number(Math.min(...samples.map(sample => sample.ratio)).toFixed(2)), unexpectedWrites }));
    const failures = samples.filter(sample => sample.ratio < 4.5);
    expect(failures, JSON.stringify(failures)).toEqual([]);
  });
}
