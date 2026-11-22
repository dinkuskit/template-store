import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pluginUniqueIndexName } from "../e2e/helpers/plugin-index";

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
/** The product the page's Commerce panel picked: Commerce holds the link (template-no-commerce-box-20261029). */
function pickedProduct(pageId: string): string {
  const database = db();
  try {
    const row = database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'product_pages' AND id = ?").get(commerce, "e:" + pageId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as { catalogItemId?: string }).catalogItemId ?? "" : "";
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
const capture = (page: Page, name: string) => page.screenshot({ path: resolve(artifacts, test.info().project.name + "-" + name + ".png"), animations: "disabled", fullPage: true });
const onShop = async (request: APIRequestContext) =>
  ((await (await request.get(`/_emdash/api/plugins/${commerce}/catalog/public`)).json()).data.products as { name: string }[]).map((item) => item.name);
const pageStatus = async (request: APIRequestContext, id: string) => {
  const body = (await (await request.get("/_emdash/api/content/products/" + id, { headers })).json()).data;
  return (body.item ?? body).status as string;
};

async function dismissWelcome(page: Page) {
  const start = page.getByRole("button", { name: "Get Started" });
  await start.or(page.getByText("Product title", { exact: true })).first().waitFor({ state: "visible", timeout: 90_000 });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
}

async function openPanel(page: Page) {
  const trigger = page.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Dinkus Commerce", exact: true });
  // On a phone the editor's settings sidebar opens from its Settings button.
  const settings = page.getByRole("main").getByRole("button", { name: "Settings", exact: true });
  await expect(trigger.or(settings).first()).toBeVisible({ timeout: 60_000 });
  if (!(await trigger.isVisible())) await settings.click();
  await expect(trigger).toBeVisible();
  // EmDash remembers an open panel across visits.
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const panel = trigger.locator("xpath=..");
  // Commerce 0.8.0: a page with no product opens on its price form, a linked page on its status grid.
  await expect(panel.getByText(/^Save makes the product as a Draft\.|^Draft: publish to sell it|^On sale$|^Published: off the shop|^Archived: off the shop/).first()).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.afterAll(() => setRole(ROLE.ADMIN));

/** A new Content > Products page whose owner saves its price in its Commerce panel: the first Save makes the product, a Draft. */
async function draftProduct(page: Page, sku: string, title: string) {
  const { request } = page;
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: sku.toLowerCase(), data: { title, visual_label: "Hat" } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await dismissWelcome(page);
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
  await panel.getByRole("textbox", { name: "Regular", exact: true }).fill("12");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  // Commerce keeps the link itself; the editor is never asked to change the page.
  const linked = await openPanel(page);
  await expect(linked.getByText(/^Draft: publish to sell it/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Review proposed changes" })).toHaveCount(0);
  const itemId = pickedProduct(pageId);
  expect(itemId).toMatch(/\S/);
  // The first Save priced it too; a phone's drawer closes on the panel's answer, so reopen it to read the saved price.
  await expect((await openPanel(page)).getByRole("textbox", { name: "Regular", exact: true }).first()).toHaveValue("12.00");
  expect(product(itemId).offSale).toBe(true);
  return { pageId, itemId };
}

test("publishing a product page sells its Commerce product, only for someone who may publish everything", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  expect((await page.request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  // Desktop and phone runs share one store, so each sells its own product.
  const sku = testInfo.project.name === "phone" ? "PAIRED-HAT-PHONE" : "PAIRED-HAT";
  expect(await onShop(request)).toEqual([]);
  // A fresh install builds Commerce's unique indexes on its first requests; the panel refuses to sell until they exist.
  await expect.poll(() => {
    const database = db();
    try {
      return database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)")
        .get(pluginUniqueIndexName(commerce, "catalog_items", "commandId"), pluginUniqueIndexName(commerce, "catalog_items", "skuKey")) as { n: number };
    } finally {
      database.close();
    }
  }, { timeout: 90_000 }).toEqual({ n: 2 });

  // 1. A fresh product: the owner adds price and stock in the page's Commerce panel. It is a Draft.
  const { pageId, itemId } = await draftProduct(page, sku, "Paired hat");
  expect(await onShop(request)).toEqual([]);
  await capture(page, "1-draft");

  // 2. The admin publishes from the editor: the store's publish check puts the product on sale.
  if (testInfo.project.name === "phone") await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Publish( now)?$/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish now", exact: true }).click();
  await expect.poll(() => pageStatus(request, pageId)).toBe("published");
  await expect.poll(() => onShop(request)).toEqual(["Paired hat"]);
  expect(product(itemId)).toMatchObject({ pageId });
  expect(product(itemId)).not.toHaveProperty("offSale", true);
  await page.reload();
  const onSalePanel = await openPanel(page);
  await expect(onSalePanel.getByText("On sale", { exact: true }).first()).toBeVisible();
  await expect(onSalePanel.getByText(sku, { exact: true }).first()).toBeVisible();
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

  // 6b. The page title is the product's one name (template-page-title-is-name-20261026): the admin renames the
  // published page and publishes it, and a Commerce that saves `name` shows the new title on the shop; an older
  // Commerce keeps its own name.
  const renamed = "Paired hat renamed " + testInfo.project.name;
  const current = (await (await request.get("/_emdash/api/content/products/" + pageId, { headers })).json()).data;
  expect((await request.put("/_emdash/api/content/products/" + pageId, { headers, data: { data: { title: renamed }, _rev: current._rev } })).ok()).toBe(true);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  const names = process.env.DINKUS_PAIRED_COMMERCE_NAMES === "1";
  const shopName = names ? renamed : "Paired hat";
  await expect.poll(() => onShop(request)).toEqual([shopName]);
  expect(product(itemId).name).toBe(shopName);
  if (names) {
    await page.goto("/products/" + sku.toLowerCase());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);
    await capture(page, "6b-renamed-on-shop");
  }

  // 7. An existing store: the page was published and its product on sale before the store had this check,
  // so the product has no page record and no Draft flag (the shape Commerce 0.5.0 stored), and Commerce knows
  // only the panel's pick. Unpublishing still takes it off sale, and publishing claims it again.
  const database = db();
  try {
    const row = { ...product(itemId) };
    delete row.pageId;
    delete row.offSale;
    database.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = 'catalog_items' AND id = ?").run(JSON.stringify(row), commerce, itemId);
    database.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = 'product_pages' AND id LIKE 'p:%'").run(commerce);
  } finally {
    database.close();
  }
  expect(await onShop(request)).toEqual([shopName]);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(itemId)).toMatchObject({ offSale: true, pageId });
  expect(await onShop(request)).toEqual([]);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toEqual([shopName]);

  // 8. Trash is reversible: keep the product linked and off sale, then restore the same page as a draft.
  expect((await request.delete(`/_emdash/api/content/products/${pageId}`, { headers })).ok()).toBe(true);
  expect(product(itemId)).toMatchObject({ offSale: true, pageId });
  expect(await onShop(request)).toEqual([]);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/restore`, { headers })).ok()).toBe(true);
  expect(await pageStatus(request, pageId)).toBe("draft");
  expect(product(itemId)).toMatchObject({ offSale: true, pageId });
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toEqual([shopName]);
  // Only irreversible deletion releases it. Commerce makes every product for its page (dinkuskit/commerce#241), and
  // deleting the page for good deletes its product too and frees its SKU (dinkuskit/commerce#288).
  expect((await request.delete(`/_emdash/api/content/products/${pageId}`, { headers })).ok()).toBe(true);
  expect((await request.delete(`/_emdash/api/content/products/${pageId}/permanent`, { headers })).ok()).toBe(true);
  await expect.poll(() => product(itemId)).toEqual({});
  expect(await onShop(request)).toEqual([]);

  // 9-12. Authority and links changed inside one request, through the same real routes. SQLite triggers land each
  // change at an exact point between this request's own writes: when EmDash writes the page, or when Commerce
  // writes the product. A new page gets its own product through Commerce's catalog route, made for that page.
  const second = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: sku.toLowerCase() + "-again", data: { title: "Paired hat again", visual_label: "Hat" } } })).json()).data;
  const againId: string = (second.item ?? second).id;
  const againCreated = await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data: { op: "create", commandId: `${sku.toLowerCase()}-again`, name: "Paired hat again", sku: `${sku}-AGAIN`, entryId: againId, regular: "12", stockStatus: "in-stock" } });
  expect(againCreated.ok(), await againCreated.text()).toBe(true);
  const againItemId: string = (await againCreated.json()).data.catalogItemId;
  const triggers: string[] = [];
  const onDb = (sql: string) => {
    const database = db();
    try {
      database.exec(sql);
    } finally {
      database.close();
    }
  };
  const trigger = (name: string, when: string, body: string) => {
    triggers.push(name);
    onDb(`CREATE TRIGGER ${name} ${when} BEGIN ${body}; END`);
  };
  const dropTriggers = () => {
    for (const name of triggers.splice(0)) onDb(`DROP TRIGGER IF EXISTS ${name}`);
    setRole(ROLE.ADMIN);
  };
  const pageWrite = (status: string) => `AFTER UPDATE OF status ON ec_products WHEN NEW.id = '${againId}' AND NEW.status = '${status}'`;
  const productWrite = (event: string) => `AFTER ${event} ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id = '${againItemId}'`;
  const demote = `UPDATE users SET role = ${ROLE.AUTHOR}`;
  const page2 = () => pageStatus(request, againId);
  try {
    // 9. An admin publishes, and is lowered to Author the moment EmDash publishes the page: the page goes live,
    // but the store reads the person again before the on-sale write, so Commerce never puts the product on sale.
    trigger("proof_demote_on_publish", pageWrite("published"), demote);
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    expect(await page2()).toBe("published");
    expect(product(againItemId).offSale).toBe(true);
    expect(product(againItemId)).not.toHaveProperty("pageId");
    expect(await onShop(request)).toEqual([]);
    dropTriggers();
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    // The page that now sells the product names it.
    await expect.poll(() => onShop(request)).toEqual(["Paired hat again"]);

    // 10. An admin unpublishes; Commerce takes the product off sale, the person is lowered at that write, and the page
    // change then fails. Putting the product back on sale would need the permission again, so it stays off sale.
    for (const event of ["INSERT", "UPDATE"]) trigger("proof_demote_on_product_" + event, productWrite(event), demote);
    trigger("proof_refuse_unpublish", `BEFORE UPDATE OF status ON ec_products WHEN OLD.id = '${againId}' AND NEW.status = 'draft'`, "SELECT RAISE(ABORT, 'proof page change refused')");
    expect((await request.post(`/_emdash/api/content/products/${againId}/unpublish`, { headers })).ok()).toBe(false);
    expect(await page2()).toBe("published");
    expect(product(againItemId).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
    dropTriggers();

    // 11. An admin publishes again; at the on-sale write the person is lowered and the page is unpublished from
    // elsewhere. The store's read-back finds the page no longer published and takes the product off sale again,
    // even though the person lost the permission meanwhile.
    for (const event of ["INSERT", "UPDATE"]) {
      trigger("proof_unpublish_on_sale_" + event, productWrite(event) + " AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) != 1",
        `${demote}; UPDATE ec_products SET status = 'draft' WHERE id = '${againId}'`);
    }
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    expect(await page2()).toBe("draft");
    expect(product(againItemId).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
    dropTriggers();

    // 12. An admin publishes, and Commerce's link for the page moves to another product the moment Commerce puts the first on sale:
    // the store's read-back sees the new link and takes the first product off sale again.
    for (const event of ["INSERT", "UPDATE"]) {
      trigger("proof_relink_on_sale_" + event, productWrite(event) + " AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) != 1",
        `UPDATE _plugin_storage SET data = json_set(data, '$.catalogItemId', '01PROOFRELINKED00000000000') WHERE plugin_id = '${commerce}' AND collection = 'product_pages' AND id = 'e:${againId}'`);
    }
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    expect(await page2()).toBe("published");
    expect(product(againItemId).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
  } finally {
    dropTriggers();
  }
});

test("a page EmDash publishes on schedule sells its product with nobody signed in, only on an Editor or Admin's schedule", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  const phone = testInfo.project.name === "phone";
  const stored = (id: string) => {
    const database = db();
    try {
      return database.prepare("SELECT status, scheduled_at FROM ec_products WHERE id = ?").get(id) as { status: string; scheduled_at: string | null } | undefined;
    } finally {
      database.close();
    }
  };
  const scheduleAt = (id: string, scheduledAt: string) =>
    request.post(`/_emdash/api/content/products/${id}/schedule`, { headers, data: { scheduledAt } });
  const schedule = (id: string, inMs = 3_000) => scheduleAt(id, new Date(Date.now() + inMs).toISOString());
  // EmDash's own scheduler publishes the page (every minute at most on Node, as the Cron Trigger on Cloudflare).
  // Nobody makes a request meanwhile, so the page goes live with nobody signed in, and Commerce sells it then
  // (dinkuskit/commerce scheduled-sale-in-commerce-20261122): no admin visit is needed.
  const scheduledPublish = async (id: string) => {
    await page.goto("about:blank");
    await expect.poll(() => stored(id), { timeout: 120_000, intervals: [1_000] }).toEqual({ status: "published", scheduled_at: null });
  };

  const { pageId, itemId } = await draftProduct(page, phone ? "PAIRED-SCHEDULED-PHONE" : "PAIRED-SCHEDULED", "Scheduled hat");
  const cap = await draftProduct(page, phone ? "PAIRED-RESCHEDULED-PHONE" : "PAIRED-RESCHEDULED", "Rescheduled cap");

  // 13. The admin schedules the hat page. EmDash publishes it with nobody signed in, and Commerce puts its product
  // on sale at once, under the page's title.
  const scheduled = await schedule(pageId);
  expect(scheduled.ok(), await scheduled.text()).toBe(true);
  expect(stored(pageId)?.status).toBe("scheduled");
  await scheduledPublish(pageId);
  await expect.poll(() => product(itemId).offSale ?? false, { timeout: 30_000 }).toBe(false);
  expect(product(itemId)).toMatchObject({ pageId });
  expect(await onShop(request)).toEqual(["Scheduled hat"]);
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await expect((await openPanel(page)).getByText("On sale", { exact: true }).first()).toBeVisible();
  await capture(page, "13-scheduled-on-sale");

  // 14. The same person as an Author schedules the cap page. EmDash publishes it, and the product stays a Draft, as
  // after an Author's own publish.
  setRole(ROLE.AUTHOR);
  try {
    expect((await schedule(cap.pageId)).ok()).toBe(true);
  } finally {
    setRole(ROLE.ADMIN);
  }
  await scheduledPublish(cap.pageId);
  expect(product(cap.itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual(["Scheduled hat"]);
  await page.goto("/_emdash/admin/content/products/" + cap.pageId);
  await expect((await openPanel(page)).getByText(/^Draft: publish to sell it/)).toBeVisible();
  await capture(page, "14-author-scheduled-still-draft");

  // 15. One request never lends its authority to another's schedule. After an admin unpublish, the admin schedules the
  // cap page; then the same person, lowered to Author, schedules it again for the same moment, so the schedule EmDash
  // holds may be the Author's. EmDash publishes it, and the product stays a Draft.
  expect((await request.post(`/_emdash/api/content/products/${cap.pageId}/unpublish`, { headers })).ok()).toBe(true);
  const moment = new Date(Date.now() + 15_000).toISOString();
  expect((await scheduleAt(cap.pageId, moment)).ok()).toBe(true);
  setRole(ROLE.AUTHOR);
  try {
    const again = await scheduleAt(cap.pageId, moment);
    expect(again.ok(), await again.text()).toBe(true);
  } finally {
    setRole(ROLE.ADMIN);
  }
  await scheduledPublish(cap.pageId);
  expect(product(cap.itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual(["Scheduled hat"]);

  // Desktop and phone share one store: delete both pages for good, which deletes their products, so the next run
  // starts from an empty shop.
  for (const id of [pageId, cap.pageId]) {
    expect((await request.delete(`/_emdash/api/content/products/${id}`, { headers })).ok()).toBe(true);
    expect((await request.delete(`/_emdash/api/content/products/${id}/permanent`, { headers })).ok()).toBe(true);
  }
  await expect.poll(() => onShop(request)).toEqual([]);
});
