import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// The owning boundary is the real admin insert -> published page -> live collection.
// The disposable collection avoids changing an initialized starter's seed/schema.
test("shop owner inserts a query card and published records update without page edits", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/query-card-20260926/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const context = await browser.newContext();
  const admin = await context.newPage();
  const source = testInfo.project.name === "chromium-desktop" ? "desktop_notices" : "mobile_notices";
  const headers = { "X-EmDash-Request": "1" };
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/pages/home");
  try {
    await expect(admin.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  }
  await expect(admin.locator(".ProseMirror")).toBeVisible();
  const originalResponse = await admin.request.get("/_emdash/api/content/pages/home");
  expect(originalResponse.ok()).toBe(true);
  const original = (await originalResponse.json()).data.item;
  const schema = await admin.request.post("/_emdash/api/schema/collections", {
    headers, data: { slug: source, label: "Shop notices", labelSingular: "Shop notice", supports: ["drafts", "revisions"] },
  });
  expect(schema.status(), await schema.text()).toBe(201);
  for (const slug of ["title", "text", "image", "link"]) {
    const field = await admin.request.post(
      "/_emdash/api/schema/collections/" + source + "/fields",
      { headers, data: { slug, label: slug, type: "string", validation: null, options: {} } },
    );
    expect(field.status(), await field.text()).toBe(201);
  }
  async function addRecord(slug: string, title: string, publish: boolean) {
    const created = await admin.request.post("/_emdash/api/content/" + source, {
      headers, data: { slug, status: "draft", data: {
        title, text: "Current shop news, maintained in EmDash.", image: "/merch/cap.svg", link: "/products/canvas-cap",
      } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).data.item.id;
    if (publish) {
      const response = await admin.request.post("/_emdash/api/content/" + source + "/" + id + "/publish", { headers });
      expect(response.ok(), await response.text()).toBe(true);
    }
  }
  try {
    await addRecord("first", "First shop notice", true);
    await addRecord("draft", "Draft notice stays private", false);
    const editor = admin.locator(".ProseMirror");
    await editor.click();
    await admin.keyboard.press("Control+a");
    await admin.keyboard.press("ArrowRight");
    await admin.keyboard.press("Enter");
    await admin.keyboard.type("/query");
    await admin.getByText("A list of current records from one collection", { exact: true }).click();
    const dialog = admin.getByRole("dialog", { name: "Insert Query Card" });
    await expect(dialog).toBeVisible();
    await dialog.locator("label", { hasText: "Source" }).locator("xpath=following-sibling::input[1]").fill(source);
    await dialog.locator("label", { hasText: "Limit" }).locator("xpath=following-sibling::input[1]").fill("6");
    await admin.screenshot({ path: resolve(root, "admin-insert.png"), fullPage: true });
    const saved = admin.waitForResponse(r => r.request().method() === "PUT" && r.url().includes("/content/pages/") && (r.request().postData() ?? "").includes("dinkus.query-card"));
    await dialog.getByRole("button", { name: "Insert", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(dialog).toHaveCount(0);
    const published = admin.waitForResponse(r => r.request().method() === "POST" && r.url().includes("/content/pages/") && r.url().includes("/publish"));
    await admin.getByRole("button", { name: "Publish changes", exact: true }).click();
    await admin.getByRole("dialog", { name: "Publish changes?" }).getByRole("button", { name: "Publish changes", exact: true }).click();
    expect((await published).ok()).toBe(true);
    await page.goto("/");
    const cards = page.locator('[data-dinkus-block="query-card"]');
    await expect(cards.locator("article")).toHaveCount(1);
    await expect(cards.getByRole("link", { name: "First shop notice" })).toHaveAttribute("href", "/products/canvas-cap");
    await expect(cards.getByText("Current shop news, maintained in EmDash.")).toBeVisible();
    await expect(cards.locator("img")).toHaveAttribute("src", "/merch/cap.svg");
    expect(await cards.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.getByText("Draft notice stays private")).toHaveCount(0);
    await page.screenshot({ path: resolve(root, "public-before.png"), fullPage: true });
    await addRecord("added", "New shop notice appears", true);
    await page.reload();
    await expect(cards.locator("article")).toHaveCount(2);
    await expect(cards.getByRole("link", { name: "New shop notice appears" })).toBeVisible();
    await expect(page.getByText("Draft notice stays private")).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: resolve(root, "public-after.png"), fullPage: true });
    await admin.goto("/_emdash/admin/content/" + source);
    await expect(admin.getByText("New shop notice appears", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(admin.getByText("Draft notice stays private", { exact: true })).toBeVisible();
    await admin.screenshot({ path: resolve(root, "admin-records.png"), fullPage: true });
    await context.addCookies([{ name: "emdash-edit-mode", value: "true", url: testInfo.project.use.baseURL ?? "http://127.0.0.1:" + (process.env.DINKUS_E2E_PORT ?? "4321") }]);
    await admin.goto("/");
    await expect(admin.locator(".emdash-inline-editor")).toBeVisible({ timeout: 30_000 });
    await expect(admin.locator(".emdash-plugin-block-placeholder").filter({ hasText: "dinkus.query-card" })).toBeVisible();
    await admin.screenshot({ path: resolve(root, "public-edit-mode.png"), fullPage: true });
    await writeFile(resolve(root, "assertions.json"), JSON.stringify({ source, publishedBefore: 1, publishedAfter: 2, draftExcluded: true, imageLoaded: true, safeLink: true, publicEditMode: "plugin placeholder; edit in admin", pageRepublishedAfterRecordAdd: false }, null, 2) + String.fromCharCode(10));
  } finally {
    const restored = await admin.request.put("/_emdash/api/content/pages/" + original.id + "?locale=en", { headers, data: { data: original.data } });
    expect(restored.ok()).toBe(true);
    expect((await admin.request.post("/_emdash/api/content/pages/" + original.id + "/publish?locale=en", { headers })).ok()).toBe(true);
    await context.close();
  }
});
