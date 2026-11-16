// Qualifies the feed adapter's ?variant=<member> landing syntax against the
// built playground Worker and pinned Commerce, not the dev-server admin seed.
// No hosted connections, cart writes, payments or external feed enrollment.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { buildPlaygroundWorker, startPlaygroundVisitor, startPlaygroundWorker } from "./lib/playground-worker-proof.mjs";

const artifacts = resolve(import.meta.dirname, "../.artifacts");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(resolve(artifacts, "feed-landings-"));
let server;
let browser;
try {
  buildPlaygroundWorker();
  server = await startPlaygroundWorker({ name: "feed-landings", port: process.env.DINKUS_FEED_PROOF_PORT ?? "4665", vars: {}, persistTo: directory });
  const ip = "203.0.113.66";
  const { cookie } = await startPlaygroundVisitor(server.base, ip, server.output);
  browser = await chromium.launch({ headless: true });
  let contexts = 0;
  let checked = 0;
  for (const width of [390, 1440]) {
    for (const javaScriptEnabled of [false, true]) {
      const context = await browser.newContext({ baseURL: server.base, viewport: { width, height: 1000 }, javaScriptEnabled });
      try {
        await context.route("**/*", async route => {
          const request = route.request();
          if (!["GET", "HEAD"].includes(request.method()) || !request.url().startsWith(server.base + "/")) return route.abort();
          return route.continue({ headers: { ...request.headers(), "cf-connecting-ip": ip } });
        });
        const equals = cookie.indexOf("=");
        await context.addCookies([{ name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: server.base }]);
        const page = await context.newPage();
        await page.goto("/products/demo-hoodie");
        await expect(page.locator("[data-variant-members]")).toHaveCount(1);
        const members = JSON.parse(await page.locator("[data-variant-members]").textContent() ?? "[]");
        assert.ok(members.length > 1);
        const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
        for (const member of members) {
          const url = new URL("/products/demo-hoodie", server.base);
          url.searchParams.set("variant", member.id);
          assert.equal((await page.goto(url.href))?.status(), 200);
          // Checkout deliberately remains unconfigured. Check the member's
          // native selection, displayed price and stock instead of enabling it.
          await expect(page.locator("[data-variant-price]")).toHaveText(member.price);
          await expect(page.locator("[data-product-status]")).toHaveAttribute("data-availability-status", member.availability);
          for (const [option, value] of Object.entries(member.values)) {
            await expect(page.locator(`[data-variant-option=${JSON.stringify(option)}] :checked`)).toHaveValue(value);
          }
          await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical ?? "");
          checked++;
        }
        contexts++;
      } finally {
        await context.close();
      }
    }
  }
  console.log(`PASS: ${contexts} desktop/mobile, JS-on/off contexts; ${checked} exact-member native landing checks; family canonicals unchanged.`);
} finally {
  if (browser) await browser.close();
  if (server) await server.stop();
  rmSync(directory, { recursive: true, force: true });
}
