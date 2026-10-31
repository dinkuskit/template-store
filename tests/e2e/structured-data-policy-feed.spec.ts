import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  buildProductJsonLd,
  buildProductPreviewJsonLd,
} from "../../.artifacts/source-deps/commerce/src/features/structured-data/index.ts";
import { COMMERCE_API, catalogOp, listCatalog, openProductsList, setStockStatus } from "./helpers/product-page";

const HOSTILE = "</script><script>alert(1)</script>";
const SHIRT_GTIN = "4006381333931";

function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: Record<string, unknown> }).data;
  }
  return (body ?? {}) as Record<string, unknown>;
}

function dollarsToMinor(text: string): string {
  const match = text.replaceAll(",", "").match(/(\d+)\.(\d{2})/u);
  expect(match, text).toBeTruthy();
  return (BigInt(match![1]) * 100n + BigInt(match![2])).toString();
}

async function catalogId(admin: Page, sku: string): Promise<string> {
  let found = "";
  await expect.poll(async () => {
    try {
      found = (await listCatalog(admin.request)).find((product) => product.sku === sku)?.catalogItemId ?? "";
    } catch {
      found = "";
    }
    return found;
  }, { timeout: 60_000 }).not.toBe("");
  return found;
}

async function productScript(page: Page): Promise<Record<string, unknown>> {
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  return JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "") as Record<string, unknown>;
}

/**
 * The policy pages are EmDash content and always show their own text; the published returns page names itself as
 * the store's return policy by link only (GrillTrack policy-pages-content-20261031).
 */
async function expectPolicyPages(page: Page): Promise<void> {
  await page.goto("/shipping");
  await expect(page.locator("[data-shipping-policy-body]")).toContainText("Edit this page in EmDash");
  await expect(page.locator("[data-shipping-policy-unset]")).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\$\d|\b[A-Z]{2}\b|\d+ days/u);
  await page.goto("/returns");
  await expect(page.locator("[data-return-policy-body]")).toContainText("Edit this page in EmDash");
  await expect(page.locator("[data-return-policy-unset]")).toHaveCount(0);
  const returnsCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  const storePolicy = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "") as Record<string, unknown>;
  expect(storePolicy).toEqual({
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: expect.any(String),
    url: new URL("/", returnsCanonical ?? "").href,
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnLink: returnsCanonical },
  });
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

    await expectPolicyPages(page);

    await page.goto("/products/demo-shirt");
    await expect(page.locator("h1")).toHaveText("Dinkus Demo Heavyweight T-Shirt");
    await expect(page.locator("[data-product-sku]")).toHaveText("SKU DEMO-HOSTED-SHIRT");
    await expect(page.locator("[data-product-price]")).toHaveText("$32.00");
    await expect(page.locator("[data-availability-status]")).toHaveAttribute("data-availability-status", "in-stock");
    await expect(page.locator("[data-product-status]")).toHaveText("In stock");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical ?? "").pathname).toBe("/products/demo-shirt");
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
    }));
    expect(JSON.stringify(initialScript)).not.toMatch(/hasMerchantReturnPolicy|shippingDetails/u);
    expect(initialScript).not.toHaveProperty("inventoryLevel");
    expect(JSON.stringify(initialScript)).not.toContain("8 available");
    expect((initialScript.offers as { url?: string }).url).toBe(canonical);

    await page.goto("/products/demo-hoodie");
    // Each picker value names an option value; the members list maps it to a Commerce item.
    const hoodieMembers = JSON.parse(await page.locator("[data-variant-members]").textContent() ?? "[]") as { id: string; values: Record<string, string> }[];
    mediumHoodieId = hoodieMembers.find((member) => member.values.Color === "Black" && member.values.Size === "Medium")?.id ?? "";
    expect(mediumHoodieId).not.toBe("");
    await setStockStatus(admin.request, mediumHoodieId, "out-of-stock", { regular: "60.00", sale: "" });
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

    await catalogOp(admin.request, { op: "identifiers", catalogItemId: shirtId, gtin: SHIRT_GTIN });
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

    // The store's policies are its EmDash pages; the product's JSON-LD carries no shipping or return terms.
    await expectPolicyPages(page);
    await page.goto("/shipping");
    await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("aria-current", "page");
    await page.goto("/returns");
    await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("aria-current", "page");
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
    }));
    expect(JSON.stringify(script)).not.toMatch(/hasMerchantReturnPolicy|shippingDetails/u);
    await page.screenshot({ path: resolve(root, "demo-shirt-jsonld.png"), fullPage: true, animations: "disabled" });
    await page.goto("/shipping");
    await page.screenshot({ path: resolve(root, "shipping-policy.png"), fullPage: true, animations: "disabled" });
    await page.goto("/returns");
    await page.screenshot({ path: resolve(root, "return-policy.png"), fullPage: true, animations: "disabled" });

    // Feed channels are the product panel's feed choices, saved through the catalog route's feeds op.
    await catalogOp(admin.request, { op: "feeds", catalogItemId: shirtId, channels: ["google-merchant"] });
    await catalogOp(admin.request, { op: "feeds", catalogItemId: capId, channels: ["meta-catalog"] });
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
      await setStockStatus(admin.request, mediumHoodieId, "in-stock", { regular: "60.00", sale: "" }).catch(() => {});
    }
    if (shirtId) {
      await catalogOp(admin.request, { op: "identifiers", catalogItemId: shirtId, gtin: null }).catch(() => {});
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
    await adminContext.close();
  }
});
