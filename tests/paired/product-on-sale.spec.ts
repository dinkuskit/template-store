import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

// Run by scripts/verify-paired-product-on-sale.mjs: this store's own middleware in front of a real
// Commerce Registry build, installed under the beta profile's runtime id as a Registry store installs it.
const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const headers = { "X-EmDash-Request": "1" };
const artifacts = process.env.DINKUS_PAIRED_ARTIFACTS ?? resolve("test-results/paired-product-on-sale");
const ROLE = { AUTHOR: 30, ADMIN: 50 };

const db = () => new DatabaseSync(process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db");
function product(id: string): Record<string, unknown> {
  const database = db();
  try {
    const row = database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'catalog_items' AND id = ?").get(commerce, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : {};
  } finally {
    database.close();
  }
}
function setRole(role: number) {
  const database = db();
  try {
    database.prepare("UPDATE users SET role = ?").run(role);
  } finally {
    database.close();
  }
}
const capture = (page: Page, name: string) => page.screenshot({ path: resolve(artifacts, name + ".png"), animations: "disabled", fullPage: true });
const onShop = async (request: APIRequestContext) =>
  ((await (await request.get(`/_emdash/api/plugins/${commerce}/catalog/public`)).json()).data.products as { name: string }[]).map((item) => item.name);
const pageStatus = async (request: APIRequestContext, id: string) => {
  const body = (await (await request.get("/_emdash/api/content/products/" + id, { headers })).json()).data;
  return (body.item ?? body).status as string;
};

async function dismissWelcome(page: Page) {
  const start = page.getByRole("button", { name: "Get Started" });
  await start.or(page.getByLabel("Settings", { exact: true })).first().waitFor({ state: "visible", timeout: 90_000 });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
}

async function openPanel(page: Page) {
  const trigger = page.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Dinkus Commerce", exact: true });
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  // EmDash remembers an open panel across visits.
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const panel = trigger.locator("xpath=..");
  await expect(panel.getByText(/Not a product yet|SKU /).first()).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.afterAll(() => setRole(ROLE.ADMIN));

test("publishing a product page sells its Commerce product, only for someone who may publish everything", async ({ page }) => {
  test.setTimeout(300_000);
  expect((await page.request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  expect(await onShop(request)).toEqual([]);
  // A fresh install builds Commerce's unique indexes on its first requests; the panel refuses to sell until they exist.
  await expect.poll(() => {
    const database = db();
    try {
      return database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)")
        .get(`uidx_plugin_${commerce}_catalog_items_commandId`, `uidx_plugin_${commerce}_catalog_items_skuKey`) as { n: number };
    } finally {
      database.close();
    }
  }, { timeout: 90_000 }).toEqual({ n: 2 });

  // 1. A fresh product: the owner adds price and stock in the page's Commerce panel. It is a Draft.
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: "paired-hat", data: { title: "Paired hat", visual_label: "Hat" } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await dismissWelcome(page);
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "SKU (optional)", exact: true }).fill("PAIRED-HAT");
  await panel.getByRole("button", { name: "Add price and stock", exact: true }).click();
  await page.getByRole("dialog", { name: "Review proposed changes" }).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(panel.getByText(/^Draft: publish to sell it/)).toBeVisible({ timeout: 30_000 });
  // Wait for EmDash's autosave to keep the link, never pressing Save right after an edit.
  let itemId = "";
  await expect.poll(async () => {
    const body = (await (await request.get("/_emdash/api/content/products/" + pageId, { headers })).json()).data;
    return (itemId = (body.item ?? body).data?.commerce_item_id ?? "");
  }, { timeout: 30_000 }).toMatch(/\S/);
  const priceForm = panel.locator("form").filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
  await priceForm.getByRole("textbox", { name: "Regular", exact: true }).fill("12");
  await priceForm.getByRole("button", { name: /^Save/ }).click();
  await expect(priceForm.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("12.00");
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual([]);
  await capture(page, "1-draft");

  // 2. The admin publishes from the editor: the store's publish check puts the product on sale.
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish now", exact: true }).click();
  await expect.poll(() => pageStatus(request, pageId)).toBe("published");
  await expect.poll(() => onShop(request)).toEqual(["Paired hat"]);
  expect(product(itemId)).toMatchObject({ pageId });
  expect(product(itemId)).not.toHaveProperty("offSale", true);
  await page.reload();
  await expect((await openPanel(page)).getByText(/^On sale · SKU PAIRED-HAT/)).toBeVisible();
  await capture(page, "2-published-on-sale");

  // 3. The same signed-in person is now an Author. EmDash would let them unpublish or trash their own page,
  // but the page sells a product, so the store refuses and nothing changes.
  setRole(ROLE.AUTHOR);
  for (const attempt of [() => request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers }), () => request.delete(`/_emdash/api/content/products/${pageId}`, { headers })]) {
    const refused = await attempt();
    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("Ask an editor or admin");
  }
  expect(await pageStatus(request, pageId)).toBe("published");
  expect(await onShop(request)).toEqual(["Paired hat"]);

  // 4. Back to admin: unpublish takes the product off sale, both in storage and on the shop.
  setRole(ROLE.ADMIN);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(await pageStatus(request, pageId)).toBe("draft");
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual([]);

  // 5. As an Author they may publish their own page, but the product stays a Draft.
  setRole(ROLE.AUTHOR);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  expect(await pageStatus(request, pageId)).toBe("published");
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual([]);

  // 6. An admin sees the published page's product still a Draft, and publishing again puts it on sale.
  // (The Commerce panel itself needs content:edit_any, so an Author never sees it.)
  setRole(ROLE.ADMIN);
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await expect((await openPanel(page)).getByText(/^Draft: publish to sell it/)).toBeVisible();
  await capture(page, "6-author-published-still-draft");
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toEqual(["Paired hat"]);

  // 7. An existing store: the page was published and its product on sale before the store had this check,
  // so the product has no page record and no Draft flag (the shape Commerce 0.5.0 stored). Unpublishing
  // still takes it off sale, and publishing claims it again.
  const database = db();
  try {
    const row = { ...product(itemId) };
    delete row.pageId;
    delete row.offSale;
    database.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = 'catalog_items' AND id = ?").run(JSON.stringify(row), commerce, itemId);
    database.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = 'product_pages'").run(commerce);
  } finally {
    database.close();
  }
  expect(await onShop(request)).toEqual(["Paired hat"]);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(itemId)).toMatchObject({ offSale: true, pageId });
  expect(await onShop(request)).toEqual([]);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toEqual(["Paired hat"]);

  // 8. Trashing the page takes the product off sale and lets go of it, so another page can sell it.
  expect((await request.delete(`/_emdash/api/content/products/${pageId}`, { headers })).ok()).toBe(true);
  expect(product(itemId).offSale).toBe(true);
  expect(product(itemId)).not.toHaveProperty("pageId");
  expect(await onShop(request)).toEqual([]);
  await page.goto(`/_emdash/admin/plugins/${commerce}/settings`);
  await expect(page.getByRole("heading", { name: "Products without a page" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Paired hat").first()).toBeVisible();
  await capture(page, "8-trashed-product-without-page");
});
