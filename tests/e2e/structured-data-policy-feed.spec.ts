import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type APIResponse, type Page } from "@playwright/test";
import {
  buildProductJsonLd,
  buildProductPreviewJsonLd,
  type StructuredPoliciesInput,
  type StructuredReturnPolicy,
  type StructuredShippingPolicy,
} from "../../.artifacts/source-deps/commerce/src/features/structured-data/index.ts";
import { openProductsList } from "./helpers/product-page";

const RETURN_CATEGORIES = ["MerchantReturnFiniteReturnWindow", "MerchantReturnNotPermitted", "MerchantReturnUnlimitedWindow"] as const;
const RETURN_METHODS = ["ReturnByMail", "ReturnInStore", "ReturnAtKiosk"] as const;
const RETURN_FEES = ["FreeReturn", "ReturnFeesCustomerResponsibility", "ReturnShippingFees"] as const;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

const PLUGIN = "/_emdash/api/plugins/dinkus-commerce";
const LIST_ROUTE = `${PLUGIN}/catalog-items/list`;
const IDENTIFIERS_ROUTE = `${PLUGIN}/catalog-items/set-identifiers`;
const AVAILABILITY_ROUTE = `${PLUGIN}/catalog-items/set-manual-availability`;
const ELIGIBILITY_ROUTE = `${PLUGIN}/catalog-items/set-feed-eligibility`;
const SHIPPING_ROUTE = `${PLUGIN}/settings/shipping-policy`;
const RETURN_ROUTE = `${PLUGIN}/settings/return-policy`;
const HOSTILE = "</script><script>alert(1)</script>";
const SHIRT_GTIN = "4006381333931";

function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: Record<string, unknown> }).data;
  }
  return (body ?? {}) as Record<string, unknown>;
}

async function adminPost(admin: Page, path: string, data: Record<string, unknown>): Promise<APIResponse> {
  return admin.request.post(path, {
    data,
    headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
  });
}

function dollarsToMinor(text: string): string {
  const match = text.replaceAll(",", "").match(/(\d+)\.(\d{2})/u);
  expect(match, text).toBeTruthy();
  return (BigInt(match![1]) * 100n + BigInt(match![2])).toString();
}

async function catalogId(admin: Page, sku: string): Promise<string> {
  let found = "";
  await expect.poll(async () => {
    const listed = await adminPost(admin, LIST_ROUTE, {});
    if (!listed.ok()) return "";
    const products = unwrap(await listed.json()).products;
    if (!Array.isArray(products)) return "";
    found = products.find((product) => product && typeof product === "object" && product.sku === sku)?.catalogItemId ?? "";
    return found;
  }, { timeout: 60_000 }).not.toBe("");
  return found;
}

async function productScript(page: Page): Promise<Record<string, unknown>> {
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  return JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "") as Record<string, unknown>;
}

async function policyInput(page: Page): Promise<StructuredPoliciesInput> {
  await page.goto("/shipping");
  const shippingNode = page.locator("[data-shipping-policy]");
  let shipping: StructuredShippingPolicy | null = null;
  if (await shippingNode.count()) {
    const mode = await shippingNode.getAttribute("data-shipping-mode");
    const configurationId = await shippingNode.getAttribute("data-shipping-configuration-id");
    if ((mode === "free" || mode === "flat") && configurationId) {
      const minor = await shippingNode.getAttribute("data-shipping-minor");
      const countries = await shippingNode.getAttribute("data-shipping-countries");
      const handlingMin = await shippingNode.getAttribute("data-handling-min");
      const handlingMax = await shippingNode.getAttribute("data-handling-max");
      const transitMin = await shippingNode.getAttribute("data-transit-min");
      const transitMax = await shippingNode.getAttribute("data-transit-max");
      shipping = {
        revision: Number(await shippingNode.getAttribute("data-policy-revision")),
        configurationId,
        mode,
        ...(minor ? { amount: { currency: "USD" as const, minor } } : {}),
        ...(countries ? { shippingDestinationCountries: countries.split(",") } : {}),
        ...(handlingMin && handlingMax ? { handlingTimeDays: { min: Number(handlingMin), max: Number(handlingMax) } } : {}),
        ...(transitMin && transitMax ? { transitTimeDays: { min: Number(transitMin), max: Number(transitMax) } } : {}),
      };
    }
  }
  await page.goto("/returns");
  const returnNode = page.locator("[data-return-policy]");
  let returns: StructuredReturnPolicy | null = null;
  if (await returnNode.count()) {
    const category = oneOf(await returnNode.getAttribute("data-return-category"), RETURN_CATEGORIES);
    const method = oneOf(await returnNode.getAttribute("data-return-method"), RETURN_METHODS);
    const fees = oneOf(await returnNode.getAttribute("data-return-fees"), RETURN_FEES);
    const countries = await returnNode.getAttribute("data-return-countries");
    const days = await returnNode.getAttribute("data-return-days");
    returns = {
      revision: Number(await returnNode.getAttribute("data-policy-revision")),
      ...(countries ? { applicableCountry: countries.split(",") } : {}),
      ...(category ? { returnPolicyCategory: category } : {}),
      ...(days ? { merchantReturnDays: Number(days) } : {}),
      ...(method ? { returnMethod: method } : {}),
      ...(fees ? { returnFees: fees } : {}),
    };
  }
  return { ...(shipping ? { shipping } : {}), ...(returns ? { returns } : {}) };
}

test("published Commerce products, policies, and feeds share one public revision", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(240_000);
  const root = resolve(process.env.DINKUS_ISSUE35_PROOF_ROOT ?? "runs/issue35-runs/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await openProductsList(admin);

  let shirtId = "";
  let mediumHoodieId = "";
  let originalDescription: string | undefined;
  let productEntryId = "";
  let shippingPageEntryId = "";
  let originalShippingPageData: Record<string, unknown> | undefined;
  const footerPolicies = page.getByRole("navigation", { name: "Policies & Care" });
  try {
    await page.goto("/");
    const shirtCard = page.locator('a[data-product-link][href="/products/demo-shirt"]');
    await expect.poll(async () => { await page.reload(); return shirtCard.count(); }, { timeout: 60_000 }).toBe(1);
    await expect(footerPolicies).toContainText("Policies & Care");
    await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("href", "/shipping");
    await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("href", "/returns");
    shirtId = await catalogId(admin, "DEMO-HOSTED-SHIRT");
    const capId = await catalogId(admin, "DEMO-HOSTED-CAP");
    const mugId = await catalogId(admin, "DEMO-HOSTED-MUG");
    const hoodieId = await catalogId(admin, "DEMO-HOSTED-HOODIE-S");

    await page.goto("/shipping");
    const shippingAlreadySet = await page.locator("[data-shipping-policy]").count();
    if (shippingAlreadySet === 0) {
      await expect(page.locator("[data-shipping-policy-unset]")).toHaveText("Shipping policy is not configured.");
      await expect(page.locator("[data-policy-body]")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(/\$\d|\b[A-Z]{2}\b|\d+ days/u);
    }
    await page.goto("/returns");
    if (await page.locator("[data-return-policy]").count() === 0) {
      await expect(page.locator("[data-return-policy-unset]")).toHaveText("Return policy is not configured.");
      await expect(page.locator("[data-policy-body]")).toHaveCount(0);
    }

    await page.goto("/products/demo-shirt");
    await expect(page.locator("h1")).toHaveText("Dinkus Demo Heavyweight T-Shirt");
    await expect(page.locator("[data-product-sku]")).toHaveText("SKU DEMO-HOSTED-SHIRT");
    await expect(page.locator("[data-product-price]")).toHaveText("$32.00");
    await expect(page.locator("[data-availability-status]")).toHaveAttribute("data-availability-status", "in-stock");
    await expect(page.locator("[data-product-status]")).toHaveText("In stock");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical ?? "").pathname).toBe("/products/demo-shirt");
    const initialPolicies = await policyInput(page);
    await page.goto("/products/demo-shirt");
    const initialScript = await productScript(page);
    const description = await page.locator(".product-detail__description").innerText();
    expect(initialScript).toEqual(buildProductJsonLd({
      product: {
        id: await page.locator("[data-product-page]").getAttribute("data-commerce-item") ?? "",
        name: await page.locator("h1").innerText(),
        sku: await page.locator("[data-product-sku]").getAttribute("data-product-sku") ?? "",
        price: { currency: "USD", minor: dollarsToMinor(await page.locator("[data-product-price]").innerText()) },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
      page: {
        url: canonical ?? "",
        name: await page.locator("h1").innerText(),
        ...(description ? { description } : {}),
      },
      ...(initialPolicies.shipping || initialPolicies.returns ? { policies: initialPolicies } : {}),
    }));
    expect(initialScript).not.toHaveProperty("inventoryLevel");
    expect(JSON.stringify(initialScript)).not.toContain("8 available");
    expect((initialScript.offers as { url?: string }).url).toBe(canonical);

    await page.goto("/products/demo-hoodie");
    // Each picker value names an option value; the members list maps it to a Commerce item.
    const hoodieMembers = JSON.parse(await page.locator("[data-variant-members]").textContent() ?? "[]") as { id: string; values: Record<string, string> }[];
    mediumHoodieId = hoodieMembers.find((member) => member.values.Color === "Black" && member.values.Size === "Medium")?.id ?? "";
    expect(mediumHoodieId).not.toBe("");
    const mediumUnavailable = await adminPost(admin, AVAILABILITY_ROUTE, { catalogItemId: mediumHoodieId, status: "out-of-stock" });
    expect(mediumUnavailable.ok(), await mediumUnavailable.text()).toBe(true);
    await page.reload();
    const hoodieCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    await expect(page.locator("[data-product-sku]")).toHaveAttribute("data-product-sku", "DEMO-HOSTED-HOODIE-S");
    await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
    const initialHoodie = await productScript(page);
    expect(initialHoodie.offers).toMatchObject({ price: "56.00", priceCurrency: "USD", availability: "https://schema.org/InStock" });
    await page.getByLabel("Medium").check();
    await expect(page.locator("[data-variant-price]")).toHaveText("$60.00");
    await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
    await expect(page.locator("[data-product-status]")).toHaveAttribute("data-availability-status", "out-of-stock");
    const selectedHoodie = await productScript(page);
    expect(selectedHoodie.offers).toMatchObject({ price: "60.00", priceCurrency: "USD", availability: "https://schema.org/OutOfStock", url: hoodieCanonical });
    expect(selectedHoodie.sku).toBe(await page.locator("[data-product-sku]").getAttribute("data-product-sku"));
    expect(selectedHoodie.url).toBe(hoodieCanonical);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", hoodieCanonical ?? "");
    await expect(page).toHaveURL(/\/products\/demo-hoodie$/);
    await page.getByLabel("Small").check();
    await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
    await expect(page.locator("[data-product-status]")).toHaveText("In stock");
    await expect(page.locator("[data-product-status]")).toHaveAttribute("data-availability-status", "in-stock");
    expect(await productScript(page)).toEqual(initialHoodie);
    await page.getByLabel("Medium").check();
    await page.reload();
    await expect(page.getByLabel("Small")).toBeChecked();
    expect(await productScript(page)).toEqual(initialHoodie);

    for (const editorial of ["/products/everyday-tee", "/products/canvas-cap", "/products/boxy-tee-preview"]) {
      const response = await page.goto(editorial);
      expect(response?.ok(), editorial).toBe(true);
      const preview = await productScript(page);
      expect(preview).toEqual(buildProductPreviewJsonLd({
        url: await page.locator('link[rel="canonical"]').getAttribute("href") ?? "",
        name: await page.locator("h1").innerText(),
        description: await page.locator(".product-detail__description").innerText(),
        images: [new URL(await page.locator(".product-detail__visual img").getAttribute("src") ?? "", page.url()).href],
      }));
      expect(preview).not.toHaveProperty("sku");
      expect(preview).not.toHaveProperty("offers");
      await expect(page.locator("[data-product-sku]")).toHaveCount(0);
    }

    const identified = await adminPost(admin, IDENTIFIERS_ROUTE, { catalogItemId: shirtId, gtin: SHIRT_GTIN });
    expect(identified.ok(), await identified.text()).toBe(true);
    await page.goto("/products/demo-shirt");
    await expect.poll(async () => {
      await page.reload();
      return page.locator("[data-product-gtin]").textContent();
    }, { timeout: 20_000 }).toContain(SHIRT_GTIN);
    expect((await productScript(page)).gtin).toBe(SHIRT_GTIN);
    await page.goto("/products/demo-cap");
    await expect(page.locator("[data-product-gtin]")).toHaveCount(0);
    expect(await productScript(page)).not.toHaveProperty("gtin");

    const current = await admin.request.get("/_emdash/api/content/products/demo-shirt");
    expect(current.ok(), await current.text()).toBe(true);
    const item = unwrap(await current.json()).item as { id: string; data: Record<string, unknown> };
    productEntryId = item.id;
    originalDescription = String(item.data.description ?? "");
    const hostileData = { ...item.data, description: HOSTILE };
    const saved = await admin.request.put(`/_emdash/api/content/products/${item.id}?locale=en`, {
      headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
      data: { data: hostileData },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const published = await admin.request.post(`/_emdash/api/content/products/${item.id}/publish?locale=en`, {
      headers: { "X-EmDash-Request": "1" },
    });
    expect(published.ok(), await published.text()).toBe(true);
    await page.goto("/products/demo-shirt");
    await expect.poll(async () => {
      await page.reload();
      return page.locator(".product-detail__description").innerText();
    }, { timeout: 20_000 }).toBe(HOSTILE);
    const raw = await page.content();
    expect(raw).not.toContain("</script><script>");
    expect(raw.match(/<script\b[^>]*type=["']application\/ld\+json["']/gu)).toHaveLength(1);
    expect((await productScript(page)).description).toBe(HOSTILE);

    const restored = await admin.request.put(`/_emdash/api/content/products/${item.id}?locale=en`, {
      headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
      data: { data: item.data },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
    const republished = await admin.request.post(`/_emdash/api/content/products/${item.id}/publish?locale=en`, {
      headers: { "X-EmDash-Request": "1" },
    });
    expect(republished.ok(), await republished.text()).toBe(true);
    await page.goto("/products/demo-shirt");
    await expect.poll(async () => {
      await page.reload();
      return page.locator(".product-detail__description").innerText();
    }, { timeout: 20_000 }).toBe(originalDescription);
    originalDescription = undefined;

    const projectKey = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
    const revisions = [
      {
        shipping: {
          configurationId: `issue35-${projectKey}-a`,
          mode: "flat",
          amount: { currency: "USD", minor: projectKey === "mobile" ? "900" : "500" },
          shippingDestinationCountries: ["US"],
          handlingTimeDays: { min: 1, max: 2 },
          transitTimeDays: { min: 3, max: 5 },
        },
        returns: {
          applicableCountry: ["US"],
          returnPolicyCategory: "MerchantReturnFiniteReturnWindow",
          merchantReturnDays: projectKey === "mobile" ? 21 : 30,
          returnMethod: "ReturnByMail",
          returnFees: "FreeReturn",
        },
      },
      {
        shipping: {
          configurationId: `issue35-${projectKey}-b`,
          mode: "flat",
          amount: { currency: "USD", minor: projectKey === "mobile" ? "1100" : "700" },
          shippingDestinationCountries: ["CA"],
          handlingTimeDays: { min: 2, max: 4 },
          transitTimeDays: { min: 4, max: 6 },
        },
        returns: {
          applicableCountry: ["CA"],
          returnPolicyCategory: "MerchantReturnFiniteReturnWindow",
          merchantReturnDays: projectKey === "mobile" ? 45 : 14,
          returnMethod: "ReturnByMail",
          returnFees: "ReturnShippingFees",
        },
      },
    ] as const;
    let previousShipping = 0;
    await page.goto("/shipping");
    if (await page.locator("[data-shipping-policy]").count()) {
      previousShipping = Number(await page.locator("[data-shipping-policy]").getAttribute("data-policy-revision"));
    }
    let previousReturn = 0;
    await page.goto("/returns");
    if (await page.locator("[data-return-policy]").count()) {
      previousReturn = Number(await page.locator("[data-return-policy]").getAttribute("data-policy-revision"));
    }
    for (const revision of revisions) {
      const shippingWrite = await adminPost(admin, SHIPPING_ROUTE, { ...revision.shipping });
      expect(shippingWrite.ok(), await shippingWrite.text()).toBe(true);
      const returnWrite = await adminPost(admin, RETURN_ROUTE, { ...revision.returns });
      expect(returnWrite.ok(), await returnWrite.text()).toBe(true);
      await page.goto("/shipping");
      await expect.poll(async () => {
        await page.reload();
        return page.locator("[data-shipping-policy]").getAttribute("data-policy-revision");
      }, { timeout: 20_000 }).not.toBe(String(previousShipping));
      const shippingRevision = Number(await page.locator("[data-shipping-policy]").getAttribute("data-policy-revision"));
      expect(shippingRevision).toBeGreaterThan(previousShipping);
      previousShipping = shippingRevision;
      await expect(page.locator("[data-shipping-policy]")).toContainText(
        `$${Number(revision.shipping.amount.minor) / 100}`,
      );
      await expect(page.locator("[data-shipping-policy]")).not.toContainText("Revision");
      await expect(page.locator("[data-shipping-countries]")).toHaveAttribute(
        "data-shipping-countries",
        revision.shipping.shippingDestinationCountries.join(","),
      );
      await expect(page.locator("[data-shipping-policy-body]")).toContainText("Order processing & cut-off times");
      await expect(page.locator("[data-shipping-policy-body]")).toContainText("Carrier tracking & delivery");
      await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("aria-current", "page");
      await page.goto("/returns");
      await expect.poll(async () => {
        await page.reload();
        return page.locator("[data-return-policy]").getAttribute("data-policy-revision");
      }, { timeout: 20_000 }).not.toBe(String(previousReturn));
      const returnRevision = Number(await page.locator("[data-return-policy]").getAttribute("data-policy-revision"));
      expect(returnRevision).toBeGreaterThan(previousReturn);
      previousReturn = returnRevision;
      await expect(page.locator("[data-return-policy]")).toContainText(`${revision.returns.merchantReturnDays} days`);
      await expect(page.locator("[data-return-policy]")).toContainText("Return by mail");
      await expect(page.locator("[data-return-policy]")).toContainText(
        revision.returns.returnFees === "FreeReturn" ? "Free returns" : "Return shipping fees apply",
      );
      await expect(page.locator("[data-return-policy]")).not.toContainText("ReturnByMail");
      await expect(page.locator("[data-return-policy]")).not.toContainText("ReturnShippingFees");
      await expect(page.locator("[data-return-policy]")).not.toContainText("Revision");
      await expect(page.locator("[data-return-policy-body]")).toContainText("Item condition & eligibility");
      await expect(page.locator("[data-return-policy-body]")).toContainText("How to initiate a return");
      await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("aria-current", "page");
      const policies = await policyInput(page);
      await page.goto("/products/demo-shirt");
      const shirtCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      const script = await productScript(page);
      expect(script).toEqual(buildProductJsonLd({
        product: {
          id: shirtId,
          name: "Dinkus Demo Heavyweight T-Shirt",
          sku: "DEMO-HOSTED-SHIRT",
          price: { currency: "USD", minor: "3200" },
          availability: { status: "in-stock", sellable: true, listable: true },
          gtin: SHIRT_GTIN,
        },
        page: {
          url: shirtCanonical ?? "",
          name: "Dinkus Demo Heavyweight T-Shirt",
          description: "A substantial cotton tee with an easy everyday fit.",
        },
        policies,
      }));
      expect(JSON.stringify(script)).not.toContain("inventoryLevel");
    }

    const shippingEntryResp = await admin.request.get("/_emdash/api/content/pages/shipping");
    expect(shippingEntryResp.ok(), await shippingEntryResp.text()).toBe(true);
    const shippingEntry = unwrap(await shippingEntryResp.json()).item as { id: string; data: Record<string, unknown> };
    shippingPageEntryId = shippingEntry.id;
    originalShippingPageData = shippingEntry.data;
    const customShippingHeading = `Dispatch schedule (${projectKey})`;
    const customShippingBody = "Orders placed before the daily cut-off leave the warehouse the next business day.";
    const savedShippingPage = await admin.request.put(`/_emdash/api/content/pages/${shippingEntry.id}?locale=en`, {
      headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
      data: {
        data: {
          ...shippingEntry.data,
          content: [
            {
              _type: "block",
              _key: "custom-shipping-heading",
              style: "h2",
              children: [{ _type: "span", _key: "custom-shipping-heading-span", text: customShippingHeading }],
            },
            {
              _type: "block",
              _key: "custom-shipping-body",
              style: "normal",
              children: [{ _type: "span", _key: "custom-shipping-body-span", text: customShippingBody }],
            },
          ],
        },
      },
    });
    expect(savedShippingPage.ok(), await savedShippingPage.text()).toBe(true);
    const publishedShippingPage = await admin.request.post(`/_emdash/api/content/pages/${shippingEntry.id}/publish?locale=en`, {
      headers: { "X-EmDash-Request": "1" },
    });
    expect(publishedShippingPage.ok(), await publishedShippingPage.text()).toBe(true);
    await page.goto("/shipping");
    await expect.poll(async () => {
      await page.reload();
      return page.locator("[data-shipping-policy-body]").innerText();
    }, { timeout: 20_000 }).toContain(customShippingHeading);
    await expect(page.locator("[data-shipping-policy-body]")).toContainText(customShippingBody);
    await expect(page.locator("[data-shipping-policy]")).toHaveAttribute("data-policy-revision", String(previousShipping));
    const restoredShippingPage = await admin.request.put(`/_emdash/api/content/pages/${shippingEntry.id}?locale=en`, {
      headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
      data: { data: originalShippingPageData },
    });
    expect(restoredShippingPage.ok(), await restoredShippingPage.text()).toBe(true);
    const republishedShippingPage = await admin.request.post(`/_emdash/api/content/pages/${shippingEntry.id}/publish?locale=en`, {
      headers: { "X-EmDash-Request": "1" },
    });
    expect(republishedShippingPage.ok(), await republishedShippingPage.text()).toBe(true);
    await expect.poll(async () => {
      await page.reload();
      return page.locator("[data-shipping-policy-body]").innerText();
    }, { timeout: 20_000 }).toContain("Order processing & cut-off times");
    originalShippingPageData = undefined;

    for (const [category, label] of [
      ["MerchantReturnFiniteReturnWindow", "Limited return window"],
      ["MerchantReturnNotPermitted", "Returns not accepted"],
      ["MerchantReturnUnlimitedWindow", "Unlimited return window"],
    ] as const) {
      const changed = await adminPost(admin, RETURN_ROUTE, {
        applicableCountry: ["CA"],
        returnPolicyCategory: category,
        ...(category === "MerchantReturnFiniteReturnWindow" ? { merchantReturnDays: 14 } : {}),
      });
      expect(changed.ok(), await changed.text()).toBe(true);
      await page.goto("/returns");
      const policy = page.locator("[data-return-policy]");
      await expect(policy).toHaveAttribute("data-return-category", category);
      await expect(policy.locator("dd").first()).toHaveText(label);
      await expect(policy).not.toContainText(category.replace("MerchantReturn", ""));
      await page.screenshot({ path: resolve(root, `returns-${category}.png`), fullPage: true, animations: "disabled" });
    }
    const restoredReturns = await adminPost(admin, RETURN_ROUTE, { ...revisions[revisions.length - 1].returns });
    expect(restoredReturns.ok(), await restoredReturns.text()).toBe(true);
    await page.goto("/products/demo-shirt");
    await page.screenshot({ path: resolve(root, "demo-shirt-jsonld.png"), fullPage: true, animations: "disabled" });
    await page.goto("/shipping");
    await page.screenshot({ path: resolve(root, "shipping-policy.png"), fullPage: true, animations: "disabled" });
    await page.goto("/returns");
    await page.screenshot({ path: resolve(root, "return-policy.png"), fullPage: true, animations: "disabled" });

    const shirtChannels = await adminPost(admin, ELIGIBILITY_ROUTE, { catalogItemId: shirtId, channels: ["google-merchant"] });
    expect(shirtChannels.ok(), await shirtChannels.text()).toBe(true);
    const capChannels = await adminPost(admin, ELIGIBILITY_ROUTE, { catalogItemId: capId, channels: ["meta-catalog"] });
    expect(capChannels.ok(), await capChannels.text()).toBe(true);
    await page.goto("/products/demo-shirt");
    const shirtLink = await page.locator('link[rel="canonical"]').getAttribute("href");
    await page.goto("/products/demo-cap");
    const capLink = await page.locator('link[rel="canonical"]').getAttribute("href");
    const google = await request.get("/feeds/google-merchant.xml");
    const meta = await request.get("/feeds/meta-catalog.csv");
    expect(google.status()).toBe(200);
    expect(google.headers()["content-type"]).toContain("xml");
    expect(meta.status()).toBe(200);
    expect(meta.headers()["content-type"]).toContain("csv");
    const googleBody = await google.text();
    const metaBody = await meta.text();
    expect(googleBody).toContain(`<g:id>${shirtId}</g:id>`);
    expect(googleBody).toContain(`<g:link>${shirtLink}</g:link>`);
    expect(googleBody).toContain(`<g:gtin>${SHIRT_GTIN}</g:gtin>`);
    expect(googleBody).not.toContain(capId);
    expect(googleBody).not.toContain(mugId);
    expect(googleBody).not.toContain(hoodieId);
    expect(googleBody).not.toContain("boxy-tee");
    expect(metaBody).toContain(capId);
    expect(metaBody).toContain(capLink ?? "");
    expect(metaBody).not.toContain(shirtId);
    expect(metaBody).not.toContain(mugId);
    expect(metaBody).not.toContain(hoodieId);
    for (const feedPath of ["/feeds/google-merchant.xml/", "/feeds/meta-catalog.csv/", "/shipping/", "/returns/"]) {
      const slash = await request.get(feedPath, { maxRedirects: 0 });
      expect(slash.status(), feedPath).not.toBe(200);
      if (slash.status() === 301 || slash.status() === 302) {
        expect(new URL(slash.headers().location ?? "", slash.url()).pathname).toBe(feedPath.slice(0, -1));
      }
    }
  } finally {
    if (mediumHoodieId) {
      await adminPost(admin, AVAILABILITY_ROUTE, { catalogItemId: mediumHoodieId, status: "in-stock" });
    }
    if (shirtId) {
      await adminPost(admin, IDENTIFIERS_ROUTE, { catalogItemId: shirtId, gtin: null });
    }
    if (originalDescription !== undefined && productEntryId) {
      const current = await admin.request.get(`/_emdash/api/content/products/${productEntryId}`);
      if (current.ok()) {
        const item = unwrap(await current.json()).item as { data: Record<string, unknown> };
        await admin.request.put(`/_emdash/api/content/products/${productEntryId}?locale=en`, {
          headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
          data: { data: { ...item.data, description: originalDescription } },
        });
        await admin.request.post(`/_emdash/api/content/products/${productEntryId}/publish?locale=en`, {
          headers: { "X-EmDash-Request": "1" },
        });
      }
    }
    if (originalShippingPageData !== undefined && shippingPageEntryId) {
      await admin.request.put(`/_emdash/api/content/pages/${shippingPageEntryId}?locale=en`, {
        headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
        data: { data: originalShippingPageData },
      });
      await admin.request.post(`/_emdash/api/content/pages/${shippingPageEntryId}/publish?locale=en`, {
        headers: { "X-EmDash-Request": "1" },
      });
    }
    await adminContext.close();
  }
});
