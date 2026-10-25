import { expect, type Locator, type Page } from "@playwright/test";

// Commerce 0.6.0 sells a product from its Content > Products page: the page's Dinkus Commerce panel adds
// price and stock, and publishing the page puts the product on sale (the store's publish check).
const headers = { "X-EmDash-Request": "1" };

/** Signs in through the dev bypass on the Content > Products list and clears EmDash's welcome dialog. */
export async function openProductsList(admin: Page) {
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/products");
  await dismissWelcome(admin, admin.getByRole("heading", { name: "Products", exact: true }));
}

async function dismissWelcome(admin: Page, ready: Locator) {
  const start = admin.getByRole("button", { name: "Get Started" });
  await start.or(ready).first().waitFor({ state: "visible", timeout: 90_000 });
  if (await start.isVisible()) await start.click();
  await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  await expect(ready).toBeVisible();
}

/** The page's Dinkus Commerce panel, opened in the editor's settings sidebar. */
export async function openPanel(admin: Page) {
  const trigger = admin.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Dinkus Commerce", exact: true });
  // On a phone the editor's settings sidebar opens from its Settings button.
  const settings = admin.getByRole("main").getByRole("button", { name: "Settings", exact: true });
  await expect(trigger.or(settings).first()).toBeVisible({ timeout: 60_000 });
  if (!(await trigger.isVisible())) await settings.click();
  await expect(trigger).toBeVisible();
  // EmDash remembers an open panel across visits.
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const panel = trigger.locator("xpath=..");
  await expect(panel.getByText(/Not a product yet|SKU /).first()).toBeVisible({ timeout: 30_000 });
  return panel;
}

/** Opens a product page in the editor with its panel showing. */
export async function openProductPage(admin: Page, pageId: string) {
  await admin.goto("/_emdash/admin/content/products/" + pageId);
  await dismissWelcome(admin, admin.getByText("Product title", { exact: true }));
  return openPanel(admin);
}

/**
 * A new Content > Products page whose panel adds price and stock: the Commerce product is a Draft
 * (off the shop) until the page is published.
 */
export async function draftProductPage(admin: Page, { title, sku, slug }: { title: string; sku: string; slug?: string }) {
  const { request } = admin;
  const response = await request.post("/_emdash/api/content/products", { headers, data: { slug: slug ?? sku.toLowerCase(), data: { title, visual_label: "Hat" } } });
  expect(response.ok(), await response.text()).toBe(true);
  const created = (await response.json()).data;
  const pageId: string = (created.item ?? created).id;
  const panel = await openProductPage(admin, pageId);
  await panel.getByRole("textbox", { name: "SKU (optional)", exact: true }).fill(sku);
  await panel.getByRole("button", { name: "Add price and stock", exact: true }).click();
  await admin.getByRole("dialog", { name: "Review proposed changes" }).getByRole("button", { name: "Apply changes", exact: true }).click();
  // On a phone, applying the change closes the settings drawer.
  await expect((await openPanel(admin)).getByText(/^Draft: publish to sell it/)).toBeVisible({ timeout: 30_000 });
  // Wait for EmDash's autosave to keep the link, never pressing Save right after an edit.
  let itemId = "";
  await expect.poll(async () => {
    const body = (await (await request.get("/_emdash/api/content/products/" + pageId, { headers })).json()).data;
    return (itemId = (body.item ?? body).data?.commerce_item_id ?? "");
  }, { timeout: 30_000 }).toMatch(/\S/);
  return { pageId, itemId };
}

/**
 * Publishes the open product page from its editor, as the owner does; the store's publish check puts its
 * product on sale. Publishing behind the open editor's back would leave it on a stale draft that refuses edits.
 */
export async function publishProductPage(admin: Page, pageId: string) {
  // On a phone the settings drawer covers the editor's Publish button.
  const close = admin.getByRole("button", { name: "Close settings", exact: true });
  if (await close.isVisible()) await close.click();
  await admin.getByRole("button", { name: /^Publish( now)?$/ }).first().click();
  await admin.getByRole("dialog").getByRole("button", { name: "Publish now", exact: true }).click();
  await expect.poll(async () => {
    const body = (await (await admin.request.get("/_emdash/api/content/products/" + pageId, { headers })).json()).data;
    return (body.item ?? body).status;
  }, { timeout: 30_000 }).toBe("published");
  await expect((await openPanel(admin)).getByText(/^On sale · SKU /)).toBeVisible({ timeout: 30_000 });
}

/** Saves the panel's Regular and Sale prices and returns the panel as it answered. */
export async function savePanelPrices(admin: Page, regular: string, sale: string) {
  const panel = await openPanel(admin);
  const form = panel.locator("form").filter({ has: admin.getByRole("textbox", { name: "Regular", exact: true }) });
  await form.getByRole("textbox", { name: "Regular", exact: true }).fill(regular);
  await form.getByRole("textbox", { name: "Sale", exact: true }).fill(sale);
  // The editor posts panel actions to EmDash's plugin-extensions route for the page.
  const answered = admin.waitForResponse((r) => r.url().includes("/plugin-extensions/dinkus-commerce/panel/") && r.request().method() === "POST");
  await form.getByRole("button", { name: /^Save$/ }).click();
  expect((await answered).ok()).toBe(true);
  // A phone's drawer closes on the panel's answer, so reopen it to read what it shows.
  return openPanel(admin);
}

/** The panel's price fields, for reading what it saved. */
export function panelPrice(admin: Page, panel: Locator, label: "Regular" | "Sale") {
  return panel.locator("form").filter({ has: admin.getByRole("textbox", { name: "Regular", exact: true }) })
    .getByRole("textbox", { name: label, exact: true });
}
