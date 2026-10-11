import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const paidReceipt = {
  orderNumber: 1001,
  test: true,
  status: "paid",
  items: [{ name: "Everyday Tee", variant: "M", quantity: 1, unitCents: 2400, totalCents: 2400 }],
  subtotalCents: 2400,
  shippingCents: 500,
  taxCents: 0,
  totalCents: 2900,
  currency: "USD",
  shipTo: {
    name: "Test Shopper",
    line1: "1 Example Way",
    city: "Testville",
    state: "CA",
    postalCode: "00000",
    country: "US",
  },
  email: "shopper@example.test",
};

async function startReceiptServer() {
  const seen: { authorization?: string; sessionId?: string } = {};
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    seen.authorization = request.headers.authorization;
    seen.sessionId = url.searchParams.get("session_id") ?? undefined;
    if (seen.sessionId === "cs_missing") {
      response.writeHead(404, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify(paidReceipt));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(4661, "127.0.0.1", resolveListen);
  });
  return { server, seen };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => error ? reject(error) : resolveClose()));
}

test("success page renders a server-fetched test order and a safe not-found state", async ({
  page,
}, testInfo) => {
  const { server, seen } = await startReceiptServer();
  await mkdir(resolve("runs/payment-success"), { recursive: true });
  try {
    await page.goto("/checkout/success?session_id=cs_test_123");
    await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
    await expect(page.getByText("TEST", { exact: true })).toBeVisible();
    await expect(page.getByText("Everyday Tee")).toBeVisible();
    await expect(page.getByText("$29.00")).toBeVisible();
    await expect(page.getByText("A confirmation email is coming")).toBeVisible();
    expect(seen).toEqual({
      authorization: "Bearer browser-test-only",
      sessionId: "cs_test_123",
    });

    await page.screenshot({
      path: resolve("runs/payment-success", `${testInfo.project.name}-paid.png`),
      fullPage: true,
      animations: "disabled",
    });

    await page.goto("/checkout/success?session_id=cs_missing");
    await expect(page.getByRole("heading", { name: "We couldn't find that order" })).toBeVisible();
    await expect(page.getByText("We couldn't confirm this order")).toBeVisible();
    await expect(page.getByText("Order #1001")).toBeHidden();
    await page.screenshot({
      path: resolve("runs/payment-success", `${testInfo.project.name}-not-found.png`),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await stopServer(server);
  }
});
