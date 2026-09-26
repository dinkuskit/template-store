import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const libraryHeadline = "Welcome to the shop";
const editedHeadline = "Welcome, rewritten on this page";
const originalHeadline = "Everyday essentials, clearly presented";
const proofRoot = resolve("runs/home-opener-section-20260926/browser");

async function dismissWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await expect(page.getByRole("button", { name: "Get Started" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(welcome).toHaveCount(0);
  }
  await expect(welcome).toHaveCount(0);
}

async function openHomeEditor(page: Page): Promise<void> {
  await page.goto(
    "/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/pages/home",
  );
  await expect(page).toHaveURL(/\/_emdash\/admin\/content\/pages\/home/);
  await dismissWelcome(page);
  await expect(page.locator('input[value="DinkusKit Store Starter"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

function pluginBlocks(page: Page, label: string) {
  return page.locator("[data-node-view-wrapper]").filter({
    has: page.locator(".text-sm.font-medium", { hasText: label }),
  });
}

async function insertHomeOpener(page: Page): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.scrollIntoViewIfNeeded();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/section");
  const command = page.getByText("Insert a reusable section", { exact: true });
  await expect(command).toBeVisible({ timeout: 10_000 });
  await command.click();
  const picker = page.getByRole("dialog", { name: "Insert Section" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Home opener/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(pluginBlocks(page, "Page Hero")).toHaveCount(2);
  await expect(pluginBlocks(page, "Fact Rail")).toHaveCount(2);
}

async function editInsertedHeadline(page: Page): Promise<void> {
  const inserted = pluginBlocks(page, "Page Hero").nth(1);
  await inserted.hover();
  await inserted.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Page Hero" });
  await expect(dialog).toBeVisible();
  const headline = dialog
    .locator("label", { hasText: "Headline" })
    .locator("xpath=following-sibling::input[1]");
  await expect(headline).toHaveValue(libraryHeadline);
  await headline.fill(editedHeadline);
  const savedEdit = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/_emdash/api/content/pages/") &&
      (response.request().postData() ?? "").includes(editedHeadline),
    { timeout: 15_000 },
  );
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await savedEdit).ok()).toBe(true);
}

async function libraryHeadlineUnchanged(page: Page): Promise<void> {
  const response = await page.request.get("/_emdash/api/sections/home-opener");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: {
      title?: string;
      source?: string;
      content?: Array<{ headline?: string }> | string;
    };
  };
  const section = body.data;
  expect(section?.title).toBe("Home opener");
  expect(section?.source).toBe("theme");
  const content = Array.isArray(section?.content)
    ? section.content
    : [];
  const headlines = content
    .map((block) => block.headline)
    .filter((value): value is string => typeof value === "string");
  expect(headlines).toContain(libraryHeadline);
  expect(headlines).not.toContain(editedHeadline);
}

async function publishHome(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const publish = page.getByRole("button", { name: "Publish changes" });
  await expect(publish).toBeEnabled({ timeout: 15_000 });
  await publish.scrollIntoViewIfNeeded();
  const fromClick = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/content/pages/") &&
        response.url().includes("/publish"),
      { timeout: 5_000 },
    )
    .catch(() => null);
  await publish.click();
  const clicked = await fromClick;
  const published =
    clicked ??
    (await page.request.post("/_emdash/api/content/pages/home/publish?locale=en", {
      headers: { "X-EmDash-Request": "1" },
    }));
  expect(published.ok(), await published.text()).toBe(true);
}

async function readHomeEntry(page: Page): Promise<{
  id: string;
  data: Record<string, unknown>;
}> {
  const current = await page.request.get("/_emdash/api/content/pages/home");
  expect(current.ok()).toBe(true);
  const body = (await current.json()) as {
    data?: {
      item?: { id?: string; data?: Record<string, unknown> };
      id?: string;
      data?: Record<string, unknown>;
    };
    item?: { id?: string; data?: Record<string, unknown> };
  };
  const item = body.data?.item ?? body.item ?? body.data;
  expect(item?.id).toBeTruthy();
  expect(item?.data).toBeTruthy();
  return { id: item!.id!, data: item!.data! };
}

async function restorePreviousHome(
  page: Page,
  original: { id: string; data: Record<string, unknown> },
): Promise<void> {
  const csrf = { "X-EmDash-Request": "1" };
  const listed = await page.request.get(
    `/_emdash/api/content/pages/${original.id}/revisions?limit=20`,
  );
  expect(listed.ok()).toBe(true);
  const body = (await listed.json()) as {
    data?: {
      items?: Array<{ id: string; data?: Record<string, unknown> }>;
    };
  };
  const previous = [...(body.data?.items ?? [])].reverse().find((item) => {
    const serialized = JSON.stringify(item.data ?? {});
    return (
      serialized.includes(originalHeadline) &&
      !serialized.includes(editedHeadline) &&
      !serialized.includes(libraryHeadline)
    );
  });

  await page.keyboard.press("Escape");
  const revisions = page.getByRole("button", { name: "Revisions" });
  if ((await revisions.count()) > 0) {
    await revisions.click({ timeout: 5_000 }).catch(() => undefined);
  }
  if (previous?.id) {
    const restored = await page.request.post(
      `/_emdash/api/revisions/${previous.id}/restore`,
      { headers: csrf },
    );
    expect(restored.ok(), await restored.text()).toBe(true);
  }

  // Publish reads the live or draft revision, not the restored row. Save the
  // captured published data as that revision, then publish it.
  const replaced = await page.request.put(
    `/_emdash/api/content/pages/${original.id}?locale=en`,
    {
      headers: { ...csrf, "content-type": "application/json" },
      data: { data: original.data },
    },
  );
  expect(replaced.ok(), await replaced.text()).toBe(true);
  const published = await page.request.post(
    `/_emdash/api/content/pages/${original.id}/publish?locale=en`,
    { headers: csrf },
  );
  expect(published.ok(), await published.text()).toBe(true);
}

test("home opener section copies, edits apart from the library, publishes, and restores", async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const screenshotRoot = resolve(proofRoot, testInfo.project.name);
  await mkdir(screenshotRoot, { recursive: true });

  const setupResponse = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setupResponse.ok()).toBe(true);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await openHomeEditor(adminPage);
    const originalHome = await readHomeEntry(adminPage);
    await expect(pluginBlocks(adminPage, "Page Hero")).toHaveCount(1);
    await expect(pluginBlocks(adminPage, "Fact Rail")).toHaveCount(1);

    await insertHomeOpener(adminPage);
    await adminPage.screenshot({
      path: resolve(screenshotRoot, "admin-inserted.png"),
      fullPage: true,
    });

    await editInsertedHeadline(adminPage);
    await libraryHeadlineUnchanged(adminPage);
    await adminPage.screenshot({
      path: resolve(screenshotRoot, "admin-edited.png"),
      fullPage: true,
    });

    await publishHome(adminPage);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: editedHeadline })).toBeVisible();
    await expect(page.getByRole("heading", { name: originalHeadline })).toBeVisible();
    await expect(page.locator('[data-dinkus-block="page-hero"]')).toHaveCount(2);
    await expect(page.locator('[data-dinkus-block="fact-rail"]')).toHaveCount(2);
    await expect(page.getByText("Rewrite this rail")).toBeVisible();
    await expect(page.locator(".emdash-edit-mode, .emdash-live-edit")).toHaveCount(0);
    await page.screenshot({
      path: resolve(screenshotRoot, "public-edited.png"),
      fullPage: true,
    });

    await restorePreviousHome(adminPage, originalHome);

    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: editedHeadline })).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: libraryHeadline })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: originalHeadline })).toBeVisible();
    await expect(page.locator('[data-dinkus-block="page-hero"]')).toHaveCount(1);
    await expect(page.locator('[data-dinkus-block="fact-rail"]')).toHaveCount(1);
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(false);
    await page.screenshot({
      path: resolve(screenshotRoot, "public-restored.png"),
      fullPage: true,
    });
    await libraryHeadlineUnchanged(adminPage);
  } finally {
    await adminContext.close();
  }
});
