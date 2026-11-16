import { expect, type Page } from "@playwright/test";

/** Uses real form requests/redirected HTML. Only delivery to the enhanced handler is held. */
export async function exerciseOverlappingCartChanges(page: Page, expectedSubtotal: string) {
  const fields = page.locator("[data-guest-cart-qty]");
  await expect(fields).toHaveCount(2);
  await page.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")], undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    type Change = { quantity: string; status?: number; quantities?: number[] };
    const state = window as unknown as {
      cartChanges: Change[];
      releaseCartChanges: (() => void)[];
      restoreCartFetch: () => void;
    };
    state.cartChanges = [];
    state.releaseCartChanges = [];
    const original = window.fetch.bind(window);
    state.restoreCartFetch = () => { window.fetch = original; };
    window.fetch = async (input, init) => {
      if (typeof input !== "string" || new URL(input, location.href).pathname !== "/cart/change" || init?.method !== "POST") {
        return original(input, init);
      }
      const body = init.body as FormData;
      const change: Change = { quantity: String(body.get("quantity")) };
      state.cartChanges.push(change);
      const held = new Promise<void>((resolve) => state.releaseCartChanges.push(resolve));
      const response = await original(input, init);
      const doc = new DOMParser().parseFromString(await response.clone().text(), "text/html");
      change.status = response.status;
      change.quantities = Array.from(doc.querySelectorAll<HTMLInputElement>("[data-guest-cart-qty]"), (field) => Number(field.value));
      await held;
      return response;
    };
  });
  const changes = () => page.evaluate(() => (window as unknown as {
    cartChanges: { quantity: string; status?: number; quantities?: number[] }[];
  }).cartChanges ?? []);
  const release = (index: number) => page.evaluate((i) => {
    (window as unknown as { releaseCartChanges: (() => void)[] }).releaseCartChanges[i]?.();
  }, index);
  try {
    await fields.nth(0).fill("2");
    await fields.nth(1).fill("3");
    await page.locator("[data-guest-cart-update]").nth(0).click();
    await expect.poll(async () => (await changes())[0]?.status).toBe(200);
    await page.locator("[data-guest-cart-update]").nth(1).click();
    // Both submits were admitted, but the second request waits for the first render.
    expect((await changes()).map((change) => change.quantity)).toEqual(["2"]);
    // An edit after submission must not change the queued request, even after its form is detached.
    await fields.nth(1).fill("9");
    await expect(page.locator("[data-server-cart]")).toHaveAttribute("aria-busy", "true");
    await release(0);
    await expect.poll(async () => (await changes())[1]?.status).toBe(200);
    expect((await changes()).map((change) => change.quantity)).toEqual(["2", "3"]);
    await expect(fields.nth(1)).toHaveValue("1");
    await expect(page.locator("[data-server-cart]")).toHaveAttribute("aria-busy", "true");
    await release(1);
    await expect(fields.nth(0)).toHaveValue("2");
    await expect(fields.nth(1)).toHaveValue("3");
    await expect(page.locator("[data-server-cart]")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("[data-guest-cart-count]").first()).toHaveText("5");
    await expect(page.locator("[data-guest-cart-subtotal-amount]")).toHaveText(expectedSubtotal);
    const authoritative = await page.evaluate(async () => (await fetch("/cart.js")).json());
    expect(authoritative.cart.itemCount).toBe(5);
    expect(authoritative.cart.lines.map((line: { quantity: number }) => line.quantity)).toEqual([2, 3]);
    return { requests: await changes(), visibleQuantities: [2, 3], itemCount: 5, subtotal: expectedSubtotal };
  } finally {
    await page.evaluate(() => {
      const state = window as unknown as { releaseCartChanges: (() => void)[]; restoreCartFetch: () => void };
      state.releaseCartChanges?.forEach((release) => release());
      state.restoreCartFetch?.();
    });
  }
}
