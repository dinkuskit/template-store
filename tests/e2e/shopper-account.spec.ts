import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/shopper-account-20261020/browser");

test("storefront /account supports both instant demo opt-out and verified email OTP opt-in, plus /checkout prefill", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  await page.goto("/");
  const headerAccountLink = page.locator("[data-store-header] [data-shopper-account-nav]");
  await expect(headerAccountLink).toBeVisible();
  await expect(headerAccountLink).toHaveAttribute("href", "/account");
  await headerAccountLink.click();

  await expect(page).toHaveURL(/\/account$/u);
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.locator("[data-account-demo-card]")).toBeVisible();

  const signedOutLayout = await page.evaluate(() => {
    const stamp = document.querySelector("[data-account-signed-out] [data-account-stamp-card]");
    const vault = document.querySelector("[data-account-signed-out] [data-account-vault-card]");
    if (!(stamp instanceof HTMLElement) || !(vault instanceof HTMLElement)) return null;
    const stampStyle = getComputedStyle(stamp);
    const vaultStyle = getComputedStyle(vault);
    const stampRect = stamp.getBoundingClientRect();
    const vaultRect = vault.getBoundingClientRect();
    const horizontalGap = Math.max(vaultRect.left - stampRect.right, stampRect.left - vaultRect.right);
    const verticalGap = Math.max(vaultRect.top - stampRect.bottom, stampRect.top - vaultRect.bottom);
    return {
      stampBg: stampStyle.backgroundColor,
      vaultBg: vaultStyle.backgroundColor,
      vaultShadow: vaultStyle.boxShadow,
      separated: horizontalGap >= 20 || verticalGap >= 20,
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(signedOutLayout).toEqual({
    stampBg: "rgb(252, 251, 248)",
    vaultBg: "rgb(27, 42, 74)",
    vaultShadow: "rgb(217, 56, 30) 0px 7px 0px 0px",
    separated: true,
    noOverflow: true,
  });

  await page.screenshot({ path: resolve(root, "account-signed-out.png") });

  // 1. Path 2: Opt-Out Instant Demo Account (No PIN required, zero marketing lead capture)
  await page.locator("[data-account-demo-signin]").click();
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  await expect(page.locator("[data-account-signed-out]")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Welcome, shopper@example.com" })).toBeFocused();
  await expect(page.locator("[data-account-current-email]")).toHaveText("shopper@example.com");
  await expect(page.locator('[data-account-order="ord_demo_shopper_1001"]')).toBeVisible();
  await expect(page.locator("[data-account-order-number]")).toContainText("Order #1001");
  await expect(page.locator("[data-account-order-total]")).toHaveText("$38.00");

  const orderLine = page.locator(
    '.account-order-card__lines [data-account-order-line="demo-hosted-shirt"]',
  );
  await expect(orderLine).toBeVisible();
  const orderLineImage = orderLine.locator("[data-account-order-line-image]");
  await expect(orderLineImage).toBeVisible();
  await expect(orderLineImage).toHaveAttribute("src", "/images/products/shirt.svg");
  const thumbLoaded = await orderLineImage.evaluate(
    (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
  );
  expect(thumbLoaded).toBe(true);
  await expect(orderLine.locator("[data-account-order-line-sku]")).toHaveText(
    "SKU: DEMO-HOSTED-SHIRT",
  );
  await expect(orderLine.locator("[data-account-order-line-variant]")).toHaveText(
    "Heavyweight Cotton · Regular Fit",
  );

  const signedInLayout = await page.evaluate(() => {
    const vault = document.querySelector("[data-account-signed-in] [data-account-vault-card]");
    const ordersStamp = document.querySelector("[data-account-signed-in] [data-account-orders]");
    if (!(vault instanceof HTMLElement) || !(ordersStamp instanceof HTMLElement)) return null;
    const vaultStyle = getComputedStyle(vault);
    const stampStyle = getComputedStyle(ordersStamp);
    const vaultRect = vault.getBoundingClientRect();
    const stampRect = ordersStamp.getBoundingClientRect();
    return {
      stampBg: stampStyle.backgroundColor,
      vaultBg: vaultStyle.backgroundColor,
      vaultShadow: vaultStyle.boxShadow,
      verticalSeparation: stampRect.top - vaultRect.bottom >= 20,
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(signedInLayout).toEqual({
    stampBg: "rgb(252, 251, 248)",
    vaultBg: "rgb(27, 42, 74)",
    vaultShadow: "rgb(217, 56, 30) 0px 7px 0px 0px",
    verticalSeparation: true,
    noOverflow: true,
  });

  await expect(page.locator("[data-account-profile-name]")).toHaveValue("Alex Rivera");
  await expect(page.locator("[data-account-profile-line1]")).toHaveValue("742 Evergreen Terrace");
  await page.screenshot({ path: resolve(root, "account-demo-signed-in.png") });

  const leadsAfterDemo = (await (await request.get("/api/proof/shopper-account")).json()) as {
    leads: Array<{ email: string }>;
  };
  expect(leadsAfterDemo.leads.some((lead) => lead.email === "shopper@example.com")).toBe(false);

  // Verify /cart has no contact form and /checkout prefill populates from signed-in shopper profile
  await page.goto("/cart");
  await expect(page.locator("[data-guest-cart-contact]")).toHaveCount(0);
  await page.goto("/checkout");
  await expect(page.locator("[data-guest-cart-email]")).toHaveValue("shopper@example.com");
  await expect(page.locator("[data-guest-cart-delivery-name]")).toHaveValue("Alex Rivera");
  await expect(page.locator("[data-guest-cart-delivery-line1]")).toHaveValue("742 Evergreen Terrace");
  await expect(page.locator("[data-guest-cart-delivery-city]")).toHaveValue("Springfield");
  await expect(page.locator("[data-guest-cart-delivery-postal-code]")).toHaveValue("97477");
  await page.screenshot({ path: resolve(root, "cart-prefilled-from-account.png") });

  // Return to /account, update default shipping address, restore Springfield, and sign out
  await page.goto("/account");
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  await page.locator("[data-account-profile-city]").fill("Portland");
  await page.locator("[data-account-profile-postal-code]").fill("97201");
  await page.locator("[data-account-profile-save]").click();
  await expect(page.locator("[data-account-status]")).toContainText("Saved your default shipping address");
  await page.locator("[data-account-profile-city]").fill("Springfield");
  await page.locator("[data-account-profile-postal-code]").fill("97477");
  await page.locator("[data-account-profile-save]").click();
  await expect(page.locator("[data-account-status]")).toContainText("Saved your default shipping address");

  await page.locator("[data-account-signout]").click();
  await expect(page.locator("[data-account-signed-out]")).toBeVisible();

  // 2. Path 1: Verified Email Sign-In + Updates Opt-In (6-digit PIN required)
  const testEmail = `shopper.${testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "")}@example.com`;
  await page.locator("[data-account-email]").fill(testEmail);

  // Submitting without checking opt-in box is refused
  await page.locator("[data-account-start]").click();
  await expect(page.locator("[data-account-status]")).toContainText("Check the updates opt-in box");
  await expect(page.locator("[data-account-verify-form]")).toBeHidden();

  // Check opt-in box and request 6-digit PIN
  await page.locator("[data-account-opt-in]").check();
  await page.locator("[data-account-start]").click();
  await expect(page.locator("[data-account-verify-form]")).toBeVisible();

  const proofState = (await (
    await request.get(`/api/proof/shopper-account?email=${encodeURIComponent(testEmail)}`)
  ).json()) as {
    email: { code: string | null } | null;
    leads: Array<{ email: string }>;
  };
  expect(proofState.email?.code).toMatch(/^\d{6}$/u);
  // Unverified email is not recorded in leads yet
  expect(proofState.leads.some((lead) => lead.email === testEmail)).toBe(false);

  await page.locator("[data-account-code]").fill(proofState.email!.code!);
  await page.locator("[data-account-verify]").click();

  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Welcome, ${testEmail}` })).toBeFocused();
  await expect(page.locator("[data-account-current-email]")).toHaveText(testEmail);
  await expect(page.locator("[data-account-orders-empty]")).toBeVisible();
  await page.screenshot({ path: resolve(root, "account-verified-otp-signed-in.png") });

  const leadsAfterVerify = (await (await request.get("/api/proof/shopper-account")).json()) as {
    leads: Array<{ email: string; optInSource: string; verificationCount: number }>;
  };
  expect(leadsAfterVerify.leads).toContainEqual(
    expect.objectContaining({
      email: testEmail,
      optInSource: "playground-account-otp",
      verificationCount: 1,
    }),
  );

  // 3. Verify non-demo order lines resolve snapshot.thumbnail or render "No image" without guessed badges
  await page.route("**/account/orders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: { email: testEmail, phone: null, delivery: null },
        orders: [
          {
            orderId: "ord_merchant_proof_2001",
            receiptId: "rcpt_merchant_proof_2001",
            number: 2001,
            status: "processing",
            paidAt: "2026-10-21T12:00:00.000Z",
            total: { currency: "USD", minor: "16000" },
            lines: [
              {
                catalogItemId: "merchant-parka-l",
                name: "Merchant Field Parka",
                quantity: 1,
                unitPrice: { currency: "USD", minor: "11000" },
              },
              {
                catalogItemId: "merchant-cap-m",
                name: "Merchant Wool Cap",
                quantity: 1,
                unitPrice: { currency: "USD", minor: "5000" },
              },
            ],
            choices: [
              {
                productId: "merchant-parka",
                catalogItemId: "merchant-parka-l",
                selections: [
                  { optionId: "size", optionLabel: "Size", valueId: "l", valueLabel: "Large" },
                ],
                fulfillment: "physical",
              },
            ],
            delivery: {
              name: "Taylor Shopper",
              line1: "100 Market St",
              city: "Portland",
              region: "OR",
              postalCode: "97201",
              country: "US",
            },
          },
        ],
      }),
    });
  });

  await page.route("**/api/guest-cart/snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          {
            id: "merchant-parka-l",
            found: true,
            name: "Merchant Field Parka",
            sku: "MERCHANT-PARKA-L",
            fulfillment: "physical",
            thumbnail: {
              src: "/merch/hoodie.svg",
              alt: "Merchant Field Parka front view",
            },
          },
          {
            id: "merchant-cap-m",
            found: true,
            name: "Merchant Wool Cap",
            sku: "MERCHANT-CAP-M",
            fulfillment: "physical",
            thumbnail: null,
          },
        ],
      }),
    });
  });

  await page.reload();
  await expect(page.locator('[data-account-order="ord_merchant_proof_2001"]')).toBeVisible();

  const parkaLine = page.locator('[data-account-order-line="merchant-parka-l"]');
  await expect(parkaLine.locator("[data-account-order-line-image]")).toHaveAttribute(
    "src",
    "/merch/hoodie.svg",
  );
  await expect(parkaLine.locator("[data-account-order-line-image]")).toHaveAttribute(
    "alt",
    "Merchant Field Parka front view",
  );
  await expect(parkaLine.locator("[data-account-order-line-sku]")).toHaveText(
    "SKU: MERCHANT-PARKA-L",
  );
  await expect(parkaLine.locator("[data-account-order-line-variant]")).toHaveText("Size: Large");

  const capLine = page.locator('[data-account-order-line="merchant-cap-m"]');
  await expect(capLine.locator("[data-account-order-line-image]")).toHaveCount(0);
  await expect(capLine.locator("[data-account-order-line-thumb]")).toContainText("No image");
  await expect(capLine.locator("[data-account-order-line-sku]")).toHaveText("SKU: MERCHANT-CAP-M");
  await expect(capLine.locator("[data-account-order-line-variant]")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "account-merchant-order-media.png") });

  await page.unroute("**/account/orders");
  await page.unroute("**/api/guest-cart/snapshot**");
});
