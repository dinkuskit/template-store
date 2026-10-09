import { expect } from "@playwright/test";
import type { Browser, BrowserContext, BrowserContextOptions, Page, Route } from "@playwright/test";

export const RUNTIME_ID = "r_gshdrqaldna3r7sn";
export const RUNTIME_PREPARE = `/_emdash/api/plugins/${RUNTIME_ID}/checkout/guest/prepare`;
export const RUNTIME_START = RUNTIME_PREPARE.replace("prepare", "start");
export const RUNTIME_STATUS = RUNTIME_PREPARE.replace("prepare", "status");
export const NATIVE_PREPARE = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare";
export const SYNTHETIC_PAYMENT_URL = "https://offline-payment.invalid/session/synthetic";

export function assertLoopbackBaseOrigin(baseURL: string): URL {
  const origin = new URL(baseURL);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash || origin.username || origin.password
  ) {
    throw new Error(`offline checkout requires a loopback base origin: ${baseURL}`);
  }
  return origin;
}

export async function freshOfflineContext(
  browser: Browser,
  baseURL: string,
  viewport: BrowserContextOptions["viewport"],
): Promise<BrowserContext> {
  assertLoopbackBaseOrigin(baseURL);
  return browser.newContext({
    baseURL,
    viewport,
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
}

type ProjectionState = "pending" | "paid";
type HarnessOptions = {
  baseURL: string;
  mutateCart?: boolean;
  synthetic?: boolean;
  gateInitialPrepare?: boolean;
};

function projection(state: ProjectionState, attemptId: string | null) {
  return {
    schema: "dinkuskit.commerce.guest-checkout-projection/v1",
    state,
    attemptId,
    lines: [{
      catalogItemId: "fixture-shirt",
      name: "Synthetic fixture shirt",
      quantity: 1,
      unitPrice: { currency: "USD", minor: "2400" },
    }],
    total: { currency: "USD", minor: "2400" },
    pricing: { finalTotal: { currency: "USD", minor: "2400" } },
    redirectUrl: null,
    order: state === "paid"
      ? { orderId: "order:fixture", receiptId: "receipt:fixture", lines: [{ catalogItemId: "fixture-shirt", quantity: 1 }] }
      : null,
    retryAfter: null,
    unavailable: null,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function installOfflineCheckoutHarness(
  page: Page,
  { baseURL, mutateCart = true, synthetic = true, gateInitialPrepare = false }: HarnessOptions,
) {
  const origin = assertLoopbackBaseOrigin(baseURL).origin;
  const blocked: string[] = [];
  let statusCalls = 0;
  let prepareCalls = 0;
  let startCalls = 0;
  let capabilityId = "fixture-cap-1";
  let releaseInitialPrepare: (() => void) | null = null;
  const initialPrepareGate = gateInitialPrepare
    ? new Promise<void>((resolve) => { releaseInitialPrepare = resolve; })
    : null;

  // One context route owns the whole decision tree, including popup requests.
  // Keep synthetic handlers and deny rules together; do not add page overrides.
  await page.context().route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    if (requestURL.protocol === "http:" || requestURL.protocol === "https:") {
      if (requestURL.origin !== origin) {
        blocked.push(requestURL.href);
        await route.abort("blockedbyclient");
        return;
      }
      const path = requestURL.pathname;
      if (synthetic && path === RUNTIME_PREPARE && route.request().method() === "POST") {
        prepareCalls += 1;
        capabilityId = `fixture-cap-${prepareCalls}`;
        if (prepareCalls === 1) await initialPrepareGate;
        await json(route, {
          success: true,
          data: {
            ok: true,
            capabilityId,
            capability: { capabilityId, capability: `${capabilityId}.secret`, retention: "json-body", header: "x-commerce-guest-capability" },
            checkout: projection("pending", null),
          },
        });
        return;
      }
      if (synthetic && path === RUNTIME_START && route.request().method() === "POST") {
        startCalls += 1;
        expect(route.request().postDataJSON()).toEqual({ lines: [{ catalogItemId: "fixture-shirt", quantity: 1 }] });
        if (route.request().headers()["x-commerce-guest-capability"] !== `${capabilityId}.secret`) {
          await json(route, { success: false }, 403);
          return;
        }
        await json(route, {
          success: true,
          data: { ok: true, capabilityId, checkout: projection("pending", `fixture-attempt-${startCalls}`) },
        });
        return;
      }
      if (synthetic && path === RUNTIME_STATUS && route.request().method() === "POST") {
        statusCalls += 1;
        await json(route, {
          success: true,
          data: { ok: true, capabilityId, checkout: projection(statusCalls > 1 ? "paid" : "pending", `fixture-attempt-${startCalls}`) },
        });
        return;
      }
      if (synthetic && path === "/api/guest-cart/snapshot" && route.request().method() === "GET") {
        await json(route, {
          products: [{
            id: "fixture-shirt",
            found: true,
            name: "Synthetic fixture shirt",
            sku: "FIXTURE",
            price: { listable: true, regularText: "$24.00", saleText: null },
            availability: { status: "in-stock", sellable: true, listable: true },
          }],
        });
        return;
      }
      if (synthetic && mutateCart && path === "/cart" && route.request().method() === "GET") {
        const response = await route.fetch({ maxRedirects: 0 });
        const html = (await response.text()).replace(
          'data-guest-checkout-admitted="false"',
          'data-guest-checkout-admitted="true"',
        );
        await route.fulfill({ response, body: html });
        return;
      }
      const returnPage = route.request().method() === "GET" &&
        (path === "/checkout/success" || path === "/checkout/cancel");
      const sensitivePath = /checkout|payment/i.test(decodeURIComponent(path));
      const apiOrNavigation = path.startsWith("/_emdash/api/") || path.startsWith("/api/") || route.request().isNavigationRequest();
      if (sensitivePath && apiOrNavigation && !returnPage) {
        blocked.push(requestURL.href);
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
  return {
    counts: () => ({ statusCalls, prepareCalls, startCalls }),
    releaseInitialPrepare: () => releaseInitialPrepare?.(),
    paymentURL: SYNTHETIC_PAYMENT_URL,
    blocked,
  };
}
