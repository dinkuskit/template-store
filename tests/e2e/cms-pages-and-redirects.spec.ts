import { expect, test } from "@playwright/test";

// template-cms-pages-and-redirects-20261027: a page the owner writes in the CMS
// has its own address, and old WooCommerce addresses land on the same products.
// The Worker drops trailing slashes first (cloudflare-checkout-return.spec.ts);
// the Astro dev server answers those itself.
const csrf = { "X-EmDash-Request": "1" };

function unwrap<T>(body: unknown): T {
  return (typeof body === "object" && body !== null && "data" in body ? (body as { data: T }).data : body) as T;
}

test("a published CMS page shows at its own address", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const slug = `about-us-${testInfo.project.name.replace(/[^a-z0-9]/giu, "-").toLowerCase()}`;
  const created = await request.post("/_emdash/api/content/pages", {
    headers: csrf,
    data: {
      slug,
      status: "draft",
      data: {
        title: "About us",
        content: [{ _type: "block", _key: "story", style: "normal", markDefs: [], children: [{ _type: "span", _key: "story-s", text: "Family-run since 2019.", marks: [] }] }],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = unwrap<{ item: { id: string } }>(await created.json()).item.id;
  try {
    // A draft has no public address yet.
    expect((await page.goto(`/${slug}`))?.status()).toBe(404);
    expect((await request.post(`/_emdash/api/content/pages/${id}/publish`, { headers: csrf })).ok()).toBe(true);
    const response = await page.goto(`/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator(`[data-cms-page="${slug}"] h1`)).toHaveText("About us");
    await expect(page.getByText("Family-run since 2019.")).toBeVisible();
    await expect(page).toHaveTitle(/^About us \| /u);
    await expect(page.locator(".store-header")).toBeVisible();
  } finally {
    await request.delete(`/_emdash/api/content/pages/${id}`, { headers: csrf });
  }
});

test("an address with no page says Page not found", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-page-not-found] h1")).toHaveText("Page not found");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});

test("WooCommerce product and category addresses land on the store's pages", async ({ page }) => {
  await page.goto("/product/everyday-tee");
  await expect(page).toHaveURL(/\/products\/everyday-tee$/u);
  await expect(page.locator('[data-product-page="everyday-tee"]')).toBeVisible();
  await page.goto("/product-category/tees");
  await expect(page).toHaveURL(/\/categories\/tees$/u);
});
