import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/store-header-nav-20261017/browser");

test("the seeded main menu leads from every store page to the shop and its categories", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const phone = testInfo.project.name.includes("mobile");

  await page.goto("/");
  const header = page.locator("[data-store-header]");
  const main = page.getByRole("navigation", { name: "Main" });
  const toggle = header.getByRole("button", { name: "Menu" });
  const shopLinks = main.getByRole("button", { name: "Show Shop links" });

  if (phone) {
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(main).toBeHidden();
    await page.screenshot({ path: resolve(root, "home-menu-closed.png") });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  } else {
    await expect(toggle).toBeHidden();
  }
  await expect(main.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("link", { name: "Shop", exact: true })).toHaveAttribute("href", "/#commerce-catalog");
  const hats = main.getByRole("link", { name: "Hats" });
  await expect(hats).toBeHidden();

  if (!phone) {
    // A mouse hover opens Shop and leaving closes it, with aria-expanded in step.
    await main.getByRole("link", { name: "Shop", exact: true }).hover();
    await expect(hats).toBeVisible();
    await expect(shopLinks).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(0, 0);
    await expect(hats).toBeHidden();
    await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  }

  await shopLinks.click();
  await expect(shopLinks).toHaveAttribute("aria-expanded", "true");
  if (!phone) await page.mouse.move(0, 0);
  for (const label of ["All products", "Hats", "Hoodies", "Tees"]) {
    await expect(main.getByRole("link", { name: label })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: resolve(root, "home-shop-open.png") });

  // Escape and a second chevron click each hide the open dropdown.
  await page.keyboard.press("Escape");
  await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  await expect(shopLinks).toBeFocused();
  await expect(hats).toBeHidden();
  await shopLinks.click();
  await expect(hats).toBeVisible();
  await shopLinks.click();
  await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  await expect(hats).toBeHidden();

  await shopLinks.click();
  await main.getByRole("link", { name: "Hoodies" }).click();
  await expect(page).toHaveURL(/\/categories\/hoodies\/?$/u);
  await expect(page.locator("h1")).toHaveText("Hoodies");
  if (phone) await toggle.click();
  else await page.mouse.move(0, 0);
  await expect(main.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: resolve(root, "category-page.png") });

  for (const path of ["/cart", "/products/everyday-tee"]) {
    await page.goto(path);
    await expect(page.locator("[data-store-main-nav] a")).toHaveCount(6);
    await expect(page.locator("[data-store-header] [data-guest-cart-nav]")).toBeVisible();
    await expect(page.locator("[data-store-footer]")).toBeVisible();
  }

  // Shared StoreFooter renders <WidgetArea name="footer" /> with all 3 widget types,
  // footer_shop menu, and the cookie-persisted theme switcher.
  await page.goto("/");
  const footer = page.locator("[data-store-footer]");
  await expect(footer.locator("[data-footer-shop-nav]")).toHaveAttribute("data-nav-source", "cms");
  const widgetArea = footer.locator('[data-widget-area="footer"]');
  await expect(widgetArea).toBeVisible();
  await expect(widgetArea.locator('[data-widget-type="content"]')).toBeVisible();
  await expect(widgetArea.locator('[data-widget-type="menu"]')).toBeVisible();
  await expect(widgetArea.locator('[data-widget-type="component"] form.widget-search')).toBeVisible();

  const darkBtn = footer.locator('[data-theme-choice="dark"]');
  const lightBtn = footer.locator('[data-theme-choice="light"]');
  await darkBtn.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(darkBtn).toHaveAttribute("aria-pressed", "true");
  await lightBtn.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Reusable Portable Text section renders on /shipping and /returns.
  await page.goto("/shipping");
  await expect(page.locator('[data-policy-support-section="policy-support-note"]')).toHaveAttribute(
    "data-section-source",
    "cms",
  );
  await expect(
    page.locator('[data-policy-support-section="policy-support-note"] h3'),
  ).toHaveText("Garment care & policy provenance");

  // /search route renders <LiveSearch> and SSR FTS5 results, while excluding draft content.
  await page.goto("/search?q=Everyday");
  await expect(page.locator("emdash-live-search")).toBeVisible();
  await expect(page.locator('[data-search-result="everyday-tee"]')).toBeVisible();

  const csrfHeaders = { "X-EmDash-Request": "1" };
  const draftSlug = `draft-prototype-${testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase()}`;
  const createdDraft = await request.post("/_emdash/api/content/products", {
    headers: csrfHeaders,
    data: {
      slug: draftSlug,
      status: "draft",
      data: {
        title: "Secret Prototype Parka",
        description: "Unpublished prototype garment",
        visual_label: "hoodie",
      },
    },
  });
  expect(createdDraft.status()).toBe(201);
  const draftId = ((await createdDraft.json()) as { data: { item: { id: string } } }).data.item.id;
  try {
    await page.goto("/search?q=Prototype");
    await expect(page.locator(`[data-search-result="${draftSlug}"]`)).toHaveCount(0);

    const searchApiResp = await request.get(
      "/_emdash/api/search?q=Prototype&collections=products,categories,pages",
    );
    expect(searchApiResp.ok()).toBe(true);
    const searchApiBody = (await searchApiResp.json()) as { data?: { items?: Array<{ slug?: string }> } };
    expect(searchApiBody.data?.items?.some((item) => item.slug === draftSlug) ?? false).toBe(false);

    const forbiddenDraftStatus = await request.get("/_emdash/api/search?q=Prototype&status=draft");
    expect(forbiddenDraftStatus.status()).toBe(403);

    const suggestResp = await request.get(
      "/_emdash/api/search/suggest?q=Secret&collections=products,categories,pages",
    );
    expect(suggestResp.ok()).toBe(true);
    const suggestBody = (await suggestResp.json()) as { data?: { items?: Array<{ slug?: string }> } };
    expect(suggestBody.data?.items?.some((item) => item.slug === draftSlug) ?? false).toBe(false);
  } finally {
    await request.delete(`/_emdash/api/content/products/${draftId}`, { headers: csrfHeaders });
  }

  // Publish -> search visible -> unpublish -> excluded across /search, /_emdash/api/search, and /_emdash/api/search/suggest:
  const lifecycleSlug = `lifecycle-coat-${testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase()}`;
  const createdPublished = await request.post("/_emdash/api/content/products", {
    headers: csrfHeaders,
    data: {
      slug: lifecycleSlug,
      status: "draft",
      data: {
        title: "Lifecycle Waxed Coat",
        description: "Published then unpublished search verification item",
        visual_label: "hoodie",
        commerce_item_id: "dinkus-template-preview-lifecycle-coat",
      },
    },
  });
  expect(createdPublished.status(), await createdPublished.text()).toBe(201);
  const lifecycleId = ((await createdPublished.json()) as { data: { item: { id: string } } }).data.item.id;
  let publishedApiBody: { data?: { items?: Array<{ slug?: string; collection?: string; title?: string; snippet?: string }>; total?: number } } = {};
  let publishedSuggestBody: { data?: { items?: Array<{ slug?: string; collection?: string; title?: string }> } } = {};
  let afterUnpublishApiBody: { data?: { items?: Array<{ slug?: string }>; total?: number } } = {};
  let afterUnpublishSuggestBody: { data?: { items?: Array<{ slug?: string }> } } = {};
  try {
    const publishedLifecycle = await request.post(`/_emdash/api/content/products/${lifecycleId}/publish`, {
      headers: csrfHeaders,
    });
    expect(publishedLifecycle.ok(), await publishedLifecycle.text()).toBe(true);

    await page.goto("/search?q=Lifecycle");
    await expect(page.locator(`[data-search-result="${lifecycleSlug}"]`)).toBeVisible();

    const publishedApiResp = await request.get(
      "/_emdash/api/search?q=Lifecycle&collections=products,categories,pages",
    );
    expect(publishedApiResp.ok()).toBe(true);
    publishedApiBody = (await publishedApiResp.json()) as typeof publishedApiBody;
    expect(publishedApiBody.data?.items?.some((item) => item.slug === lifecycleSlug) ?? false).toBe(true);

    const publishedSuggestResp = await request.get(
      "/_emdash/api/search/suggest?q=Lifecycle&collections=products,categories,pages",
    );
    expect(publishedSuggestResp.ok()).toBe(true);
    publishedSuggestBody = (await publishedSuggestResp.json()) as typeof publishedSuggestBody;
    expect(
      publishedSuggestBody.data?.items?.some((item) => item.slug === lifecycleSlug) ?? false,
    ).toBe(true);

    // Unpublish the previously indexed item:
    const unpublishedResp = await request.post(`/_emdash/api/content/products/${lifecycleId}/unpublish`, {
      headers: csrfHeaders,
    });
    expect(unpublishedResp.ok(), await unpublishedResp.text()).toBe(true);

    await page.goto("/search?q=Lifecycle");
    await expect(page.locator(`[data-search-result="${lifecycleSlug}"]`)).toHaveCount(0);

    const afterUnpublishApi = await request.get(
      "/_emdash/api/search?q=Lifecycle&collections=products,categories,pages",
    );
    expect(afterUnpublishApi.ok()).toBe(true);
    afterUnpublishApiBody = (await afterUnpublishApi.json()) as typeof afterUnpublishApiBody;
    expect(
      afterUnpublishApiBody.data?.items?.some((item) => item.slug === lifecycleSlug) ?? false,
    ).toBe(false);

    const afterUnpublishSuggest = await request.get(
      "/_emdash/api/search/suggest?q=Lifecycle&collections=products,categories,pages",
    );
    expect(afterUnpublishSuggest.ok()).toBe(true);
    afterUnpublishSuggestBody = (await afterUnpublishSuggest.json()) as typeof afterUnpublishSuggestBody;
    expect(
      afterUnpublishSuggestBody.data?.items?.some((item) => item.slug === lifecycleSlug) ?? false,
    ).toBe(false);
  } finally {
    await request.delete(`/_emdash/api/content/products/${lifecycleId}`, { headers: csrfHeaders });
  }

  // Published product entry whose linked Commerce catalog item was archived/removed is excluded from search:
  const invalidProductSlug = `archived-link-${testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase()}`;
  const createdInvalid = await request.post("/_emdash/api/content/products", {
    headers: csrfHeaders,
    data: {
      slug: invalidProductSlug,
      status: "draft",
      data: {
        title: "Orphaned Catalog Jacket",
        description: "Published CMS entry whose linked Commerce product left the catalog",
        visual_label: "hoodie",
        commerce_item_id: "cat_archived_ghost_item",
      },
    },
  });
  expect(createdInvalid.status(), await createdInvalid.text()).toBe(201);
  const invalidId = ((await createdInvalid.json()) as { data: { item: { id: string } } }).data.item.id;
  let orphanSearchBody: { data?: { items?: Array<{ slug?: string }>; total?: number } } = {};
  try {
    const publishedInvalid = await request.post(`/_emdash/api/content/products/${invalidId}/publish`, {
      headers: csrfHeaders,
    });
    expect(publishedInvalid.ok(), await publishedInvalid.text()).toBe(true);

    await page.goto("/search?q=Orphaned");
    await expect(page.locator(`[data-search-result="${invalidProductSlug}"]`)).toHaveCount(0);

    const orphanSearchResp = await request.get(
      "/_emdash/api/search?q=Orphaned&collections=products,categories,pages",
    );
    expect(orphanSearchResp.ok()).toBe(true);
    orphanSearchBody = (await orphanSearchResp.json()) as typeof orphanSearchBody;
    expect(
      orphanSearchBody.data?.items?.some((item) => item.slug === invalidProductSlug) ?? false,
    ).toBe(false);
  } finally {
    await request.delete(`/_emdash/api/content/products/${invalidId}`, { headers: csrfHeaders });
  }

  await writeFile(
    resolve(root, "search-evidence.json"),
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        publishedSearch: publishedApiBody,
        publishedSuggest: publishedSuggestBody,
        forbiddenDraftStatus: 403,
        afterUnpublishSearch: afterUnpublishApiBody,
        afterUnpublishSuggest: afterUnpublishSuggestBody,
        orphanedProductSearch: orphanSearchBody,
      },
      null,
      2,
    )}\n`,
  );

  if (phone) {
    // The narrowest supported phone keeps brand, cart and Menu on screen.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    await toggle.click();
    await expect(main.getByRole("link", { name: "Shop", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: resolve(root, "home-320-menu-open.png") });
  }
});

test("without JavaScript the main menu still opens on hover and shows in full on phones", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main" });
    const hats = main.getByRole("link", { name: "Hats" });
    await expect(page.locator("[data-store-header]").getByRole("button", { name: "Menu" })).toBeHidden();
    if (testInfo.project.name.includes("mobile")) {
      await expect(hats).toBeVisible();
    } else {
      await expect(hats).toBeHidden();
      await main.getByRole("link", { name: "Shop", exact: true }).hover();
      await expect(hats).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
