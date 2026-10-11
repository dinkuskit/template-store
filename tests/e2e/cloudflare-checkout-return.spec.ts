import { spawn } from "node:child_process";

import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off", serviceWorkers: "block" });

test("real Wrangler unknown-token return handles the expected 503", async ({ browser }, testInfo) => {
  test.skip(process.env.CLOUDFLARE_E2E !== "1", "Run with CLOUDFLARE_E2E=1 after a Cloudflare build.");
  test.setTimeout(60_000);
  const port = 8799;
  const worker = spawn("pnpm", [
    "exec", "wrangler", "dev", "--local", "--port", String(port),
    "--show-interactive-dev-session=false",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH },
    stdio: "ignore",
  });
  const workerUrl = `http://127.0.0.1:${port}`;
  try {
    await expect.poll(async () => {
      try {
        const response = await fetch(`${workerUrl}/checkout/success`, {
          headers: { "cf-connecting-ip": "198.51.100.1" },
        });
        return response.status;
      } catch {
        return 0;
      }
    }, { timeout: 30_000 }).toBe(200);
    const successResponse = await fetch(`${workerUrl}/checkout/success`, {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    expect(successResponse.headers.get("cache-control")).toBe("no-store");
    for (const [path, status, target] of [
      ["/cart/", 302, "/cart"],
      ["/checkout/success/", 301, "/checkout/success"],
      ["/products/everyday-tee/", 301, "/products/everyday-tee"],
    ] as const) {
      const redirect = await fetch(`${workerUrl}${path}`, {
        redirect: "manual",
        headers: { "cf-connecting-ip": "198.51.100.1" },
      });
      expect(redirect.status).toBe(status);
      expect(new URL(redirect.headers.get("location")!, workerUrl).pathname).toBe(target);
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const oversized = await fetch(`${workerUrl}/api/checkout/status`, {
        method: "POST",
        headers: {
          "content-length": "5000",
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.1",
          "x-commerce-guest-capability": "oversized-cap.secret",
        },
        body: "x".repeat(5000),
      });
      expect(oversized.status).toBe(413);
      expect(oversized.headers.get("cache-control")).toBe("no-store");
      expect(await oversized.json()).toMatchObject({
        error: { code: "CHECKOUT_UNAVAILABLE" },
      });
    }
    const context = await browser.newContext({
      baseURL: workerUrl,
      viewport: testInfo.project.use.viewport,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({
          capabilityId: "unknown-cap",
          capability: "unknown-cap.secret",
          attemptId: "unknown-attempt",
        }));
      });
      await page.goto("/checkout/success?session_id=unknown");
      await expect(page.getByText("We couldn't confirm your order just now. Check your email.")).toBeVisible();
      expect(pageErrors).toEqual([]);
      expect(consoleErrors.some((message) => /Failed to load resource/u.test(message))).toBe(true);
    } finally {
      await context.close();
    }
  } finally {
    worker.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      worker.once("exit", () => resolve());
      setTimeout(resolve, 2_000);
    });
  }
});
