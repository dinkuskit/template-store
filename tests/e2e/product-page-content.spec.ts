import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext } from "@playwright/test";

// template-sells-anything-20261027 and template-rich-product-page-20261027:
// any kind of product gets a page, the page carries the owner's rich summary and
// sections, and Commerce's gallery shows as thumbnails.
const CREATE_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/create";
const SAVE_PRICES_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices";
const SAVE_MEDIA_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/save-media";
const csrf = { "X-EmDash-Request": "1" };

function unwrap<T>(body: unknown): T {
  return (typeof body === "object" && body !== null && "data" in body ? (body as { data: T }).data : body) as T;
}

/** A solid-colour PNG tagged with its name, so each picture has its own bytes and EmDash never deduplicates it. */
function png(name: string, rgb: [number, number, number], size = 8): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`Title\0${name}`, "latin1")),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function upload(request: APIRequestContext, name: string, rgb: [number, number, number]): Promise<string> {
  const response = await request.post("/_emdash/api/media", {
    headers: csrf,
    multipart: { file: { name, mimeType: "image/png", buffer: png(name, rgb) }, alt: name.replace(/\.png$/u, ""), width: "8", height: "8" },
  });
  expect(response.status(), await response.text()).toBe(201);
  return unwrap<{ item: { id: string } }>(await response.json()).item.id;
}

const span = (key: string, text: string, marks: string[] = []) => ({ _type: "span", _key: key, text, marks });
const block = (key: string, children: unknown[], markDefs: unknown[] = []) => ({ _type: "block", _key: key, style: "normal", markDefs, children });

test("a product of any kind shows its rich summary, sections and gallery", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/product-page-content/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const suffix = testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase();

  // A seed packet: no apparel placeholder art, sold through Commerce with a gallery.
  const created = await request.post(CREATE_ROUTE, {
    headers: csrf,
    data: { commandId: `page-content-${crypto.randomUUID()}`, name: `Runtz Candy Kush ${suffix}`, sku: `SEED-${suffix.toUpperCase()}`, manageStock: false },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const itemId = unwrap<{ item: { itemId: string } }>(await created.json()).item.itemId;
  expect((await request.post(SAVE_PRICES_ROUTE, { headers: csrf, data: { catalogItemId: itemId, regular: "22", sale: "" } })).ok()).toBe(true);
  const pictures = [
    await upload(request, `packet-front-${suffix}.png`, [40, 120, 60]),
    await upload(request, `packet-back-${suffix}.png`, [200, 160, 40]),
    await upload(request, `seeds-${suffix}.png`, [90, 50, 30]),
  ];
  const media = await request.post(SAVE_MEDIA_ROUTE, { headers: csrf, data: { catalogItemId: itemId, image: pictures[0], gallery: pictures.slice(1) } });
  expect(media.ok(), await media.text()).toBe(true);

  const slug = `runtz-candy-kush-${suffix}`;
  const entry = await request.post("/_emdash/api/content/products", {
    headers: csrf,
    data: {
      slug,
      status: "draft",
      data: {
        title: `Runtz Candy Kush ${suffix}`,
        description: "Fruity and indisputably fun.",
        commerce_item_id: itemId,
        summary: [
          block("intro", [span("intro-a", "Fruity and "), span("intro-b", "indisputably fun", ["strong"]), span("intro-c", ".")]),
          block("bulk", [span("bulk-a", "Need more? See the "), span("bulk-b", "10-count pack", ["bulk-link"])], [{ _type: "link", _key: "bulk-link", href: "/search?q=runtz" }]),
        ],
        details: [
          { _type: "collapsible_section", _version: 1, _key: "overview", heading: "Overview", open_by_default: true, content: [block("overview-p", [span("overview-s", "Runtz crossed with OG Kush.")])] },
          { _type: "spec_table", _version: 1, _key: "specs", heading: "Specifications", rows: [{ label: "Flowering time", value: "8-9 weeks" }, { label: "Pack size", value: "2 seeds" }] },
          { _type: "collapsible_section", _version: 1, _key: "germination", heading: "Germination", content: [block("germ-p", [span("germ-s", "Soak for 12 hours.")])] },
        ],
      },
    },
  });
  expect(entry.status(), await entry.text()).toBe(201);
  const entryId = unwrap<{ item: { id: string } }>(await entry.json()).item.id;
  try {
    expect((await request.post(`/_emdash/api/content/products/${entryId}/publish`, { headers: csrf })).ok()).toBe(true);
    await page.goto(`/products/${slug}`);
    const detail = page.locator(`[data-product-page="${slug}"]`);
    await expect(detail).toBeVisible();
    await expect(detail.locator("[data-product-price]")).toHaveText("$22.00");

    // The rich summary replaces the plain line in the buy box; the plain line stays the meta description.
    const summary = detail.locator("[data-product-summary]");
    await expect(summary.locator("strong")).toHaveText("indisputably fun");
    await expect(summary.getByRole("link", { name: "10-count pack" })).toHaveAttribute("href", "/search?q=runtz");
    await expect(detail.locator(".product-detail__description")).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Fruity and indisputably fun.");
    const jsonLd = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "{}");
    expect(jsonLd.description).toBe("Fruity and indisputably fun.");

    // Sections, in the owner's order.
    const sections = page.locator("[data-product-details] [data-product-section]");
    await expect(sections.locator("summary")).toHaveText(["Overview", "Germination"]);
    await expect(sections.nth(0)).toHaveAttribute("open", "");
    await expect(sections.nth(1)).not.toHaveAttribute("open", "");
    await expect(page.getByText("Soak for 12 hours.")).toBeHidden();
    await sections.nth(1).locator("summary").click();
    await expect(page.getByText("Soak for 12 hours.")).toBeVisible();
    await expect(page.locator("[data-product-specs] dt")).toHaveText(["Flowering time", "Pack size"]);
    await expect(page.locator("[data-product-specs] dd")).toHaveText(["8-9 weeks", "2 seeds"]);

    // Commerce's image first, then its gallery; picking a thumbnail shows it large.
    const thumbs = page.locator(`[data-product-gallery="${itemId}"] [data-gallery-thumb]`);
    await expect(thumbs).toHaveCount(3);
    await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
    const main = page.locator(`[data-product-gallery="${itemId}"] img[data-commerce-image]`);
    // The product page's frame reaches the gallery's stage: border, rounded clip and stamp shadow.
    const frame = await page.locator(`[data-product-gallery="${itemId}"] [data-product-stage-visual]`).evaluate((stage) => {
      const style = getComputedStyle(stage);
      return { border: style.borderTopStyle, overflow: style.overflow, shadow: style.boxShadow };
    });
    expect(frame.border).toBe("solid");
    expect(frame.overflow).toBe("hidden");
    expect(frame.shadow).not.toBe("none");
    const firstSrc = await main.getAttribute("src");
    await thumbs.nth(2).click();
    await expect(thumbs.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(thumbs.first()).toHaveAttribute("aria-pressed", "false");
    await expect(main).not.toHaveAttribute("src", firstSrc ?? "");
    await expect(main).toHaveAttribute("alt", `seeds-${suffix}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: resolve(root, "product-page.png"), fullPage: true });
  } finally {
    await request.delete(`/_emdash/api/content/products/${entryId}`, { headers: csrf });
  }
});

test("a published product with no placeholder art and no Commerce image says No image", async ({ page, request }, testInfo) => {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const slug = `plain-nutrient-${testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase()}`;
  const entry = await request.post("/_emdash/api/content/products", {
    headers: csrf,
    data: { slug, status: "draft", data: { title: "Aloe Vera Flakes", description: "Organic.", commerce_item_id: `dinkus-template-preview-${slug}` } },
  });
  expect(entry.status(), await entry.text()).toBe(201);
  const entryId = unwrap<{ item: { id: string } }>(await entry.json()).item.id;
  try {
    expect((await request.post(`/_emdash/api/content/products/${entryId}/publish`, { headers: csrf })).ok()).toBe(true);
    await page.goto(`/products/${slug}`);
    await expect(page.locator(`[data-product-page="${slug}"] h1`)).toHaveText("Aloe Vera Flakes");
    await expect(page.locator(`[data-product-image-placeholder="${slug}"]`)).toHaveText("No image");
    await expect(page.locator(".product-detail__description")).toHaveText("Organic.");
    await expect(page.locator("[data-product-details]")).toHaveCount(0);
  } finally {
    await request.delete(`/_emdash/api/content/products/${entryId}`, { headers: csrf });
  }
});
