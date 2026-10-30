import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  await expect(panel.getByText(/Not a product yet|SKU /).first()).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.afterAll(() => setRole(ROLE.ADMIN));

/** A new Content > Products page whose owner adds price and stock in its Commerce panel: the product is a Draft. */
async function draftProduct(page: Page, sku: string, title: string) {
  const { request } = page;
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: sku.toLowerCase(), data: { title, visual_label: "Hat" } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await dismissWelcome(page);
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "SKU (optional)", exact: true }).fill(sku);
  await panel.getByRole("button", { name: "Add price and stock", exact: true }).click();
  // Commerce keeps the link itself; the editor is never asked to change the page.
  const linked = await openPanel(page);
  await expect(linked.getByText(/^Draft: publish to sell it/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Review proposed changes" })).toHaveCount(0);
  const itemId = pickedProduct(pageId);
  expect(itemId).toMatch(/\S/);
  // EmDash 1.4 renders a Block Kit form block as a group named after its submit button (emdash-cms/emdash#4183).
  const priceForm = linked.locator('[role="group"]').filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
  await priceForm.getByRole("textbox", { name: "Regular", exact: true }).fill("12");
  await priceForm.getByRole("button", { name: /^Save/ }).click();
  // A phone's drawer closes on the panel's answer too, so reopen it to read the saved price.
  await expect((await openPanel(page)).getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("12.00");
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
        .get(`uidx_plugin_${commerce}_catalog_items_commandId`, `uidx_plugin_${commerce}_catalog_items_skuKey`) as { n: number };
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
  await expect((await openPanel(page)).getByText("On sale · SKU " + sku, { exact: false })).toBeVisible();
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

  // 8. Trashing the page takes the product off sale and lets go of it, so another page can sell it.
  expect((await request.delete(`/_emdash/api/content/products/${pageId}`, { headers })).ok()).toBe(true);
  expect(product(itemId).offSale).toBe(true);
  expect(product(itemId)).not.toHaveProperty("pageId");
  expect(await onShop(request)).toEqual([]);
  await page.goto(`/_emdash/admin/plugins/${commerce}/settings`);
  await expect(page.getByRole("heading", { name: "Products without a page" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(shopName).first()).toBeVisible();
  await capture(page, "8-trashed-product-without-page");

  // 9-12. Authority and links changed inside one request, through the same real routes. SQLite triggers land each
  // change at an exact point between this request's own writes: when EmDash writes the page, or when Commerce
  // writes the product. A new page sells the now unclaimed product, picked through Commerce's catalog route.
  const second = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: sku.toLowerCase() + "-again", data: { title: "Paired hat again", visual_label: "Hat" } } })).json()).data;
  const againId: string = (second.item ?? second).id;
  expect((await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data: { op: "link", entryId: againId, catalogItemId: itemId } })).ok()).toBe(true);
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
  const productWrite = (event: string) => `AFTER ${event} ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id = '${itemId}'`;
  const demote = `UPDATE users SET role = ${ROLE.AUTHOR}`;
  const page2 = () => pageStatus(request, againId);
  try {
    // 9. An admin publishes, and is lowered to Author the moment EmDash publishes the page: the page goes live,
    // but the store reads the person again before the on-sale write, so Commerce never puts the product on sale.
    trigger("proof_demote_on_publish", pageWrite("published"), demote);
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    expect(await page2()).toBe("published");
    expect(product(itemId).offSale).toBe(true);
    expect(product(itemId)).not.toHaveProperty("pageId");
    expect(await onShop(request)).toEqual([]);
    dropTriggers();
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    // The page that now sells the product names it.
    await expect.poll(() => onShop(request)).toEqual([names ? "Paired hat again" : shopName]);

    // 10. An admin unpublishes; Commerce takes the product off sale, the person is lowered at that write, and the page
    // change then fails. Putting the product back on sale would need the permission again, so it stays off sale.
    for (const event of ["INSERT", "UPDATE"]) trigger("proof_demote_on_product_" + event, productWrite(event), demote);
    trigger("proof_refuse_unpublish", `BEFORE UPDATE OF status ON ec_products WHEN OLD.id = '${againId}' AND NEW.status = 'draft'`, "SELECT RAISE(ABORT, 'proof page change refused')");
    expect((await request.post(`/_emdash/api/content/products/${againId}/unpublish`, { headers })).ok()).toBe(false);
    expect(await page2()).toBe("published");
    expect(product(itemId).offSale).toBe(true);
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
    expect(product(itemId).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
    dropTriggers();

    // 12. An admin publishes, and the page's panel picks another product the moment Commerce puts the first on sale:
    // the store's read-back sees the new link and takes the first product off sale again.
    for (const event of ["INSERT", "UPDATE"]) {
      trigger("proof_relink_on_sale_" + event, productWrite(event) + " AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) != 1",
        `UPDATE _plugin_storage SET data = json_set(data, '$.catalogItemId', '01PROOFRELINKED00000000000') WHERE plugin_id = '${commerce}' AND collection = 'product_pages' AND id = 'e:${againId}'`);
    }
    expect((await request.post(`/_emdash/api/content/products/${againId}/publish`, { headers })).ok()).toBe(true);
    expect(await page2()).toBe("published");
    expect(product(itemId).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
  } finally {
    dropTriggers();
  }
});

test("a page EmDash publishes on schedule sells its product on the next admin visit, only on an admin's confirmed schedule", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  const phone = testInfo.project.name === "phone";
  const read = <T>(sql: string, ...params: string[]) => {
    const database = db();
    try {
      return database.prepare(sql).get(...params) as T | undefined;
    } finally {
      database.close();
    }
  };
  const onDb = (sql: string) => {
    const database = db();
    try {
      database.exec(sql);
    } finally {
      database.close();
    }
  };
  const stored = (id: string) => read<{ status: string; scheduled_at: string | null }>("SELECT status, scheduled_at FROM ec_products WHERE id = ?", id);
  const pending = (id: string) => {
    const row = read<{ data: string }>("SELECT data FROM _plugin_storage WHERE plugin_id = 'dinkus-template-product-urls' AND collection = 'pending_sales' AND id = ?", id);
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : undefined;
  };
  const scheduleAt = (id: string, scheduledAt: string) =>
    request.post(`/_emdash/api/content/products/${id}/schedule`, { headers, data: { scheduledAt } });
  const schedule = (id: string, inMs = 3_000) => scheduleAt(id, new Date(Date.now() + inMs).toISOString());
  // EmDash's own scheduler publishes the page (every minute at most on Node, as the Cron Trigger on Cloudflare).
  // Nobody makes a request meanwhile, so the page goes live with nobody signed in.
  const scheduledPublish = async (id: string) => {
    await page.goto("about:blank");
    await expect.poll(() => stored(id), { timeout: 120_000, intervals: [1_000] }).toEqual({ status: "published", scheduled_at: null });
  };
  // The admin's next visits; the store checks schedules at most once a minute, so this can take up to a minute.
  const adminVisits = async (id: string, until: () => unknown, expected: unknown) => {
    await page.goto("/_emdash/admin/content/products/" + id);
    await expect.poll(async () => {
      await request.get("/_emdash/api/content/products/" + id, { headers });
      return until();
    }, { timeout: 100_000, intervals: [5_000] }).toEqual(expected);
  };

  const { pageId, itemId } = await draftProduct(page, phone ? "PAIRED-SCHEDULED-PHONE" : "PAIRED-SCHEDULED", "Scheduled hat");
  // A second page an Author published, so its product is a Draft behind a live page.
  const cap = await draftProduct(page, phone ? "PAIRED-RESCHEDULED-PHONE" : "PAIRED-RESCHEDULED", "Rescheduled cap");
  setRole(ROLE.AUTHOR);
  try {
    expect((await request.post(`/_emdash/api/content/products/${cap.pageId}/publish`, { headers })).ok()).toBe(true);
  } finally {
    setRole(ROLE.ADMIN);
  }
  expect(product(cap.itemId).offSale).toBe(true);

  // 13. The admin tries to schedule the live cap page in the past: EmDash refuses after the plugin saw the proposal, so
  // nothing is granted. The admin schedules the hat page; EmDash stores it, which grants the sale.
  expect((await schedule(cap.pageId, -60_000)).ok()).toBe(false);
  expect(pending(cap.pageId)).toMatchObject({ confirmed: null });
  const scheduled = await schedule(pageId);
  expect(scheduled.ok(), await scheduled.text()).toBe(true);
  expect(stored(pageId)?.status).toBe("scheduled");
  await expect.poll(() => pending(pageId)).toMatchObject({ proposals: [{ role: ROLE.ADMIN }], confirmed: { role: ROLE.ADMIN }, state: "scheduled" });
  // Commerce holds the page's product, so the grant names none.
  expect(pending(pageId)?.confirmed).not.toHaveProperty("itemId");
  // EmDash publishes it with nobody signed in: the product is still a Draft, the grant now published.
  await scheduledPublish(pageId);
  expect(product(itemId).offSale).toBe(true);
  await expect.poll(() => pending(pageId)?.state).toBe("published");
  // The admin's next visit puts it on sale; the cap page's failed schedule sold nothing.
  await adminVisits(pageId, () => onShop(request), ["Scheduled hat"]);
  expect(product(itemId)).toMatchObject({ pageId });
  expect(product(itemId)).not.toHaveProperty("offSale", true);
  expect(pending(pageId)).toBeUndefined();
  expect(product(cap.itemId).offSale).toBe(true);
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await expect((await openPanel(page)).getByText("On sale · SKU ", { exact: false })).toBeVisible();
  await capture(page, "13-scheduled-on-sale");

  // 14. After an admin unpublish, the same person as an Author schedules their own page. EmDash publishes it, and the
  // admin's visits drop the Author's grant without selling: the product stays a Draft, as after an Author's own publish.
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(itemId).offSale).toBe(true);
  setRole(ROLE.AUTHOR);
  try {
    expect((await schedule(pageId)).ok()).toBe(true);
  } finally {
    setRole(ROLE.ADMIN);
  }
  await expect.poll(() => pending(pageId)).toMatchObject({ confirmed: { role: ROLE.AUTHOR } });
  await scheduledPublish(pageId);
  await adminVisits(pageId, () => pending(pageId), undefined);
  expect(stored(pageId)?.status).toBe("published");
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual([]);
  await expect((await openPanel(page)).getByText(/^Draft: publish to sell it/)).toBeVisible();
  await capture(page, "14-author-scheduled-still-draft");

  // 15. One request never lends its authority to another's stored schedule. After an admin unpublish, the admin
  // schedules the page; then the same person, lowered to Author, schedules it again for the same moment, so the
  // schedule EmDash holds is the Author's request. The admin's earlier proposal is withdrawn at once: the grant is the
  // Author's. EmDash publishes it, and the admin's visits drop the grant without selling.
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  const moment = new Date(Date.now() + 15_000).toISOString();
  expect((await scheduleAt(pageId, moment)).ok()).toBe(true);
  await expect.poll(() => pending(pageId)).toMatchObject({ confirmed: { role: ROLE.ADMIN } });
  setRole(ROLE.AUTHOR);
  try {
    const again = await scheduleAt(pageId, moment);
    expect(again.ok(), await again.text()).toBe(true);
  } finally {
    setRole(ROLE.ADMIN);
  }
  await expect.poll(() => pending(pageId)).toMatchObject({ confirmed: { role: ROLE.AUTHOR } });
  await scheduledPublish(pageId);
  await adminVisits(pageId, () => pending(pageId), undefined);
  expect(stored(pageId)?.status).toBe("published");
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).toEqual([]);

  // 16. Grants withdrawn mid-sweep, and an off-sale write Commerce refuses. The admin schedules both pages and EmDash
  // publishes them, so one sweep reads both grants before writing. SQLite triggers then remove both grants at the
  // moment Commerce writes either product on sale (as a person's own publish removes a grant), and refuse Commerce's
  // off-sale writes. The first product goes on sale, its grant is gone, so the store must take it back: the refused
  // write is kept on a list. The second grant was read before that write and removed after, so its product is never
  // written on sale. Once Commerce accepts writes again, another sweep lists the same product again while the store's
  // off-sale write is in flight; that write answers only the listing it read, so the newer one stays until a later
  // visit's own off-sale write clears it.
  for (const id of [pageId, cap.pageId]) expect((await request.post(`/_emdash/api/content/products/${id}/unpublish`, { headers })).ok()).toBe(true);
  for (const id of [pageId, cap.pageId]) expect((await schedule(id, 5_000)).ok()).toBe(true);
  for (const id of [pageId, cap.pageId]) await expect.poll(() => pending(id)).toMatchObject({ confirmed: { role: ROLE.ADMIN } });
  await page.goto("about:blank");
  for (const id of [pageId, cap.pageId]) await expect.poll(() => stored(id), { timeout: 120_000, intervals: [1_000] }).toEqual({ status: "published", scheduled_at: null });
  for (const id of [pageId, cap.pageId]) await expect.poll(() => pending(id)?.state).toBe("published");
  const items = `'${itemId}', '${cap.itemId}'`;
  const onSale = "COALESCE(json_extract(NEW.data, '$.offSale'), 0) != 1";
  const triggers: string[] = [];
  const trigger = (name: string, body: string) => {
    triggers.push(name);
    onDb(`CREATE TRIGGER ${name} ${body}`);
  };
  const takebacks = () => read<{ n: number }>("SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = 'dinkus-template-product-urls' AND collection = 'pending_sales' AND id LIKE 'takeback:%'")?.n ?? 0;
  onDb("CREATE TABLE IF NOT EXISTS proof_sale_writes (item TEXT, on_sale INTEGER)");
  try {
    for (const event of ["INSERT", "UPDATE"]) {
      trigger(`proof_withdraw_on_sale_${event}`, `AFTER ${event} ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id IN (${items}) BEGIN
        INSERT INTO proof_sale_writes VALUES (NEW.id, ${onSale});
        DELETE FROM _plugin_storage WHERE plugin_id = 'dinkus-template-product-urls' AND collection = 'pending_sales' AND id IN ('${pageId}', '${cap.pageId}') AND ${onSale};
      END`);
    }
    trigger("proof_refuse_off_sale", `BEFORE UPDATE ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id IN (${items}) AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) = 1 BEGIN SELECT RAISE(ABORT, 'proof off-sale refused'); END`);
    await adminVisits(pageId, takebacks, 1);
    const writes = () => {
      const database = db();
      try {
        return database.prepare("SELECT item, on_sale FROM proof_sale_writes").all() as Array<{ item: string; on_sale: number }>;
      } finally {
        database.close();
      }
    };
    expect(writes()).toHaveLength(1);
    const [{ item: sold, on_sale: wasOnSale }] = writes();
    expect(wasOnSale).toBe(1);
    const other = sold === itemId ? cap.itemId : itemId;
    expect(product(other).offSale).toBe(true);
    for (const id of [pageId, cap.pageId]) expect(pending(id)).toBeUndefined();
    // Commerce accepts writes again. The first off-sale write that lands lists the product again (a new revision, as
    // another sweep's listing would), once.
    const listing = () => read<{ revision: string }>("SELECT revision FROM _plugin_storage WHERE plugin_id = 'dinkus-template-product-urls' AND collection = 'pending_sales' AND id LIKE 'takeback:%'")?.revision;
    const firstListing = listing();
    onDb("DROP TRIGGER IF EXISTS proof_refuse_off_sale");
    onDb("CREATE TABLE IF NOT EXISTS proof_relisted (at TEXT)");
    trigger("proof_relist_takeback", `AFTER UPDATE ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id IN (${items}) AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) = 1 AND NOT EXISTS (SELECT 1 FROM proof_relisted) BEGIN
      INSERT INTO proof_relisted VALUES (datetime('now'));
      UPDATE _plugin_storage SET revision = 'proof-relisted' WHERE plugin_id = 'dinkus-template-product-urls' AND collection = 'pending_sales' AND id LIKE 'takeback:%';
    END`);
    await adminVisits(pageId, listing, "proof-relisted");
    expect(firstListing).not.toBe("proof-relisted");
    expect(product(sold).offSale).toBe(true);
    // The newer listing stays after that write; a later visit's own off-sale write clears it, selling nothing.
    await adminVisits(pageId, takebacks, 0);
    const sequence = writes().map((write) => write.on_sale);
    expect(sequence.slice(0, 2)).toEqual([1, 0]);
    expect(sequence.slice(1).every((onSaleWrite) => onSaleWrite === 0)).toBe(true);
    expect(product(sold).offSale).toBe(true);
    expect(product(other).offSale).toBe(true);
    expect(await onShop(request)).toEqual([]);
  } finally {
    for (const name of triggers) onDb(`DROP TRIGGER IF EXISTS ${name}`);
    onDb("DROP TABLE IF EXISTS proof_sale_writes");
    onDb("DROP TABLE IF EXISTS proof_relisted");
  }

  // 17. A publish renames the scheduled page while the sweep sells it (template-page-title-is-name-20261026): an SQLite
  // trigger changes the live title at the moment Commerce writes the product on sale. The sweep's read afterwards sees
  // the newer title and renames the product with a title-only write, which never changes sale state, and only for a
  // visitor who, read again, still holds the permission: when the same trigger also lowers the person to Author, the
  // newer title is listed instead and nothing is written, and the admin's next sweep finishes it. A Commerce that
  // ignores `name` keeps "Scheduled hat" throughout.
  const names = process.env.DINKUS_PAIRED_COMMERCE_NAMES === "1";
  const retitleKey = `retitle:${pageId}:${createHash("sha256").update(itemId).digest("hex")}`;
  let expectedName = "Scheduled hat";
  for (const [variant, demote] of [["kept", false], ["revoked", true]] as const) {
    const retitled = `Scheduled hat ${variant} ${testInfo.project.name}`;
    expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
    expect((await schedule(pageId, 5_000)).ok()).toBe(true);
    await expect.poll(() => pending(pageId)).toMatchObject({ confirmed: { role: ROLE.ADMIN } });
    await scheduledPublish(pageId);
    await expect.poll(() => pending(pageId)?.state).toBe("published");
    const sentName = read<{ title: string }>("SELECT title FROM ec_products WHERE id = ?", pageId)?.title;
    onDb(`CREATE TRIGGER proof_retitle_mid_sweep AFTER UPDATE ON _plugin_storage WHEN NEW.plugin_id = '${commerce}' AND NEW.collection = 'catalog_items' AND NEW.id = '${itemId}' AND COALESCE(json_extract(NEW.data, '$.offSale'), 0) != 1 BEGIN
      UPDATE ec_products SET title = '${retitled}' WHERE id = '${pageId}';${demote ? ` UPDATE users SET role = ${ROLE.AUTHOR};` : ""}
    END`);
    try {
      await adminVisits(pageId, () => pending(pageId), undefined);
    } finally {
      onDb("DROP TRIGGER IF EXISTS proof_retitle_mid_sweep");
      setRole(ROLE.ADMIN);
    }
    expect(product(itemId)).not.toHaveProperty("offSale", true);
    if (names) expectedName = demote ? sentName ?? expectedName : retitled;
    expect(product(itemId).name).toBe(expectedName);
    await expect.poll(() => onShop(request)).toEqual([expectedName]);
    expect(pending(retitleKey)).toEqual(demote ? { retitle: true, entryId: pageId, catalogItemId: itemId } : undefined);
    if (demote) {
      // The admin, an allowed person again, visits: a later sweep gives the product the page's newest title.
      await adminVisits(pageId, () => pending(retitleKey), undefined);
      if (names) expectedName = retitled;
      expect(product(itemId).name).toBe(expectedName);
      expect(product(itemId)).not.toHaveProperty("offSale", true);
      await expect.poll(() => onShop(request)).toEqual([expectedName]);
    }
  }

  // Leave the shop empty for the next run.
  for (const id of [pageId, cap.pageId]) expect((await request.post(`/_emdash/api/content/products/${id}/unpublish`, { headers })).ok()).toBe(true);
});

// template-no-commerce-box-20261029: an older store's product pages name their product in the Commerce product box,
// and Commerce may hold no link for them. They keep selling through this template, and its upgrade takes the box off
// only once Commerce links every page that needs it, a draft as well as a published page. While it waits, a page whose
// box still names an older product follows Commerce's link.
test("an older store's product pages keep selling through the upgrade that takes the box off", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone", "The box is the store's own schema; one run proves the upgrade.");
  test.setTimeout(600_000);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  const catalog = async (body: Record<string, unknown>) => {
    const response = await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data: body });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const boxed = async () => ((await (await request.get("/_emdash/api/schema/collections/products/fields", { headers })).json()).data.items as { slug: string }[])
    .some((field) => field.slug === "commerce_item_id");
  const links = (pageId: string) => {
    const database = db();
    try {
      return (database.prepare("SELECT id FROM _plugin_storage WHERE plugin_id = ? AND collection = 'product_pages' AND id IN (?, ?) ORDER BY id")
        .all(commerce, "e:" + pageId, "p:" + pageId) as { id: string }[]).map((row) => row.id);
    } finally {
      database.close();
    }
  };
  // What an owner runs, `pnpm search:upgrade`: every storefront upgrade on this store's database, as the store runs them.
  const upgrade = () => {
    const result = spawnSync("node", ["scripts/upgrade-storefront-search.ts"], { cwd: process.cwd(), encoding: "utf8", env: process.env });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as { upgrades: string[]; waiting?: string[] };
  };
  const shows = async (path: string, price: string) => {
    await page.goto(path);
    await expect(page.locator("[data-product-price]").first()).toHaveText(price);
  };
  const status = (id: string) => {
    const database = db();
    try {
      return database.prepare("SELECT status, scheduled_at FROM ec_products WHERE id = ?").get(id) as { status: string; scheduled_at: string | null } | undefined;
    } finally {
      database.close();
    }
  };

  // 17. The store has the older seed's box, and a product an older Commerce panel linked by writing its id there.
  const added = await request.post("/_emdash/api/schema/collections/products/fields", { headers, data: { slug: "commerce_item_id", label: "Commerce product", type: "string" } });
  expect(added.status(), await added.text()).toBe(201);
  const { catalogItemId: itemId } = await catalog({ op: "create", commandId: "paired-older-store-hat", name: "Older store hat", sku: "PAIRED-OLDER-HAT" });
  await catalog({ op: "prices", catalogItemId: itemId, regular: "15.00", sale: "", stockStatus: "in-stock" });
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: "older-store-hat", data: { title: "Older store hat", visual_label: "Hat", commerce_item_id: itemId } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  expect(links(pageId)).toEqual([]);
  // A draft whose box is the only record of its product, as an older store's hand-filled box was.
  const { catalogItemId: draftItemId } = await catalog({ op: "create", commandId: "paired-older-store-scarf", name: "Older store scarf", sku: "PAIRED-OLDER-SCARF" });
  await catalog({ op: "prices", catalogItemId: draftItemId, regular: "12.00", sale: "", stockStatus: "in-stock" });
  const drafted = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: "older-store-scarf", data: { title: "Older store scarf", visual_label: "Scarf", commerce_item_id: draftItemId } } })).json()).data;
  const draftId: string = (drafted.item ?? drafted).id;
  expect(links(draftId)).toEqual([]);
  // Publishing sends the box's product, since Commerce links the page to nothing.
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toContain("Older store hat");
  expect(product(itemId)).toMatchObject({ pageId });
  await shows("/products/older-store-hat", "$15.00");
  await capture(page, "17-older-store-page-on-sale");

  // 18. A page published before Commerce kept any links: only its box names its product.
  {
    const database = db();
    try {
      database.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = 'product_pages' AND id IN (?, ?)").run(commerce, "e:" + pageId, "p:" + pageId);
    } finally {
      database.close();
    }
  }
  expect(links(pageId)).toEqual([]);
  await shows("/products/older-store-hat", "$15.00");
  // The upgrade leaves the box while that page needs it, and the page still unpublishes and publishes by its box.
  expect(upgrade().waiting).toEqual(["005_commerce_box_off"]);
  expect(await boxed()).toBe(true);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(itemId).offSale).toBe(true);
  expect(await onShop(request)).not.toContain("Older store hat");
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toContain("Older store hat");
  // That publish recorded Commerce's link for the page.
  expect(links(pageId)).toEqual(["p:" + pageId]);

  // 19. While the draft keeps the upgrade waiting, the owner picks a newer product in the hat page's Dinkus Commerce
  // panel, which no longer writes the box: the box still names the older product and Commerce links the newer one.
  const { catalogItemId: newItemId } = await catalog({ op: "create", commandId: "paired-older-store-hat-2", name: "Older store hat II", sku: "PAIRED-OLDER-HAT-2" });
  await catalog({ op: "prices", catalogItemId: newItemId, regular: "16.00", sale: "", stockStatus: "in-stock" });
  await catalog({ op: "link", entryId: pageId, catalogItemId: newItemId });
  expect(pickedProduct(pageId)).toBe(newItemId);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(itemId).offSale).toBe(true);
  // The admin schedules the page. Commerce's link comes first, so the schedule names no product and the box claims
  // nothing; EmDash's scheduler publishes it with nobody signed in, and the admin's next visit sells the newer product.
  const scheduled = await request.post(`/_emdash/api/content/products/${pageId}/schedule`, { headers, data: { scheduledAt: new Date(Date.now() + 3_000).toISOString() } });
  expect(scheduled.ok(), await scheduled.text()).toBe(true);
  await page.goto("about:blank");
  await expect.poll(() => status(pageId), { timeout: 120_000, intervals: [1_000] }).toEqual({ status: "published", scheduled_at: null });
  await page.goto("/_emdash/admin/content/products/" + pageId);
  await expect.poll(async () => {
    await request.get("/_emdash/api/content/products/" + pageId, { headers });
    return product(newItemId).offSale ?? false;
  }, { timeout: 100_000, intervals: [5_000] }).toBe(false);
  expect(product(newItemId)).toMatchObject({ pageId });
  expect(product(itemId).offSale).toBe(true);
  await shows("/products/older-store-hat", "$16.00");
  await capture(page, "19-scheduled-by-commerce-link");
  // A copy of the page whose box names the older product publishes, and sells it by its box: the hat page's box no
  // longer claims it.
  const copied = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug: "older-store-hat-copy", data: { title: "Older store hat copy", visual_label: "Hat", commerce_item_id: itemId } } })).json()).data;
  const copyId: string = (copied.item ?? copied).id;
  const copyPublished = await request.post(`/_emdash/api/content/products/${copyId}/publish`, { headers });
  expect(copyPublished.ok(), await copyPublished.text()).toBe(true);
  await expect.poll(() => product(itemId).offSale ?? false).toBe(false);
  expect(product(itemId)).toMatchObject({ pageId: copyId });
  await shows("/products/older-store-hat-copy", "$15.00");

  // 20. The draft still needs its box: the upgrade waits, and publishing the draft sells the product its box names.
  expect(upgrade().waiting).toEqual(["005_commerce_box_off"]);
  expect(await boxed()).toBe(true);
  expect(product(draftItemId).offSale).toBe(true);
  expect((await request.post(`/_emdash/api/content/products/${draftId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => onShop(request)).toContain("Older store scarf");
  expect(product(draftItemId)).toMatchObject({ pageId: draftId });
  await shows("/products/older-store-scarf", "$12.00");
  expect(links(draftId)).toEqual(["p:" + draftId]);

  // 21. Now every page's product is linked in Commerce, so the upgrade takes the box off.
  const done = upgrade();
  expect(done.waiting).toBeUndefined();
  expect(done.upgrades).toContain("005_commerce_box_off");
  expect(await boxed()).toBe(false);
  {
    const database = db();
    try {
      expect((database.prepare("SELECT name FROM pragma_table_info('ec_products')").all() as { name: string }[]).map((row) => row.name)).not.toContain("commerce_item_id");
    } finally {
      database.close();
    }
  }
  // The page still sells its product, found through Commerce: the shop, its page, unpublish and publish.
  await shows("/products/older-store-hat", "$16.00");
  await capture(page, "21-box-off-page-still-on-sale");
  expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  expect(product(newItemId).offSale).toBe(true);
  expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
  await expect.poll(() => product(newItemId).offSale ?? false).toBe(false);
  expect(product(newItemId)).toMatchObject({ pageId });

  await shows("/products/older-store-hat-copy", "$15.00");
  await shows("/products/older-store-scarf", "$12.00");

  // Trashing the pages takes their products off the shop, so the phone run starts from an empty shop.
  for (const id of [pageId, copyId, draftId]) expect((await request.delete(`/_emdash/api/content/products/${id}`, { headers })).ok()).toBe(true);
  for (const id of [itemId, newItemId, draftItemId]) expect(product(id).offSale).toBe(true);
  expect(await onShop(request)).not.toContain("Older store hat");
  expect(await onShop(request)).not.toContain("Older store scarf");
});
