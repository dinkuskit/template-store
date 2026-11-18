import { expect, type Page } from "@playwright/test";

/** Start with two real cart lines; response holds change timing, not Commerce's answer. */
export async function exerciseCartRedrawFocus(page: Page, capture?: () => Promise<void>) {
  const quantity = page.locator("[data-guest-cart-qty]");
  const update = page.locator("[data-guest-cart-update]");
  const remove = page.locator("[data-guest-cart-remove]");
  await expect(quantity).toHaveCount(2);
  await quantity.first().fill("2");
  await quantity.first().press("Enter");
  await expect(page.locator("[data-guest-cart-count]").first()).toHaveText("3");
  await expect(quantity.first()).toBeFocused();

  await quantity.first().fill("3");
  await update.first().focus(); await page.keyboard.press("Enter");
  await expect(page.locator("[data-guest-cart-count]").first()).toHaveText("4");
  await expect(update.first()).toBeFocused();
  if (capture) await capture();
  await page.keyboard.press("Tab"); await expect(remove.first()).toBeFocused();

  async function heldChange(value: string, moveFocus: () => Promise<void>, assertFocus: () => Promise<void>) {
    await page.evaluate(() => {
      const state = window as unknown as { cartFocusResponseReady: boolean; releaseCartFocusResponse: () => void; restoreCartFocusFetch: () => void };
      const original = window.fetch.bind(window);
      state.cartFocusResponseReady = false;
      state.restoreCartFocusFetch = () => { window.fetch = original; };
      window.fetch = async (input, init) => {
        if (typeof input !== "string" || new URL(input, location.href).pathname !== "/cart/change" || init?.method !== "POST") return original(input, init);
        const held = new Promise<void>(resolve => { state.releaseCartFocusResponse = resolve; });
        const response = await original(input, init);
        state.cartFocusResponseReady = true;
        await held;
        return response;
      };
    });
    try {
      await quantity.first().fill(value); await update.first().focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => (window as unknown as { cartFocusResponseReady: boolean }).cartFocusResponseReady);
      await moveFocus();
      await page.evaluate(() => (window as unknown as { releaseCartFocusResponse: () => void }).releaseCartFocusResponse());
      await expect(page.locator("[data-guest-cart-count]").first()).toHaveText(String(Number(value) + 1));
      await assertFocus();
    } finally {
      await page.evaluate(() => {
        const state = window as unknown as { releaseCartFocusResponse?: () => void; restoreCartFocusFetch: () => void };
        state.releaseCartFocusResponse?.(); state.restoreCartFocusFetch();
      });
    }
  }
  await heldChange("4", () => quantity.nth(1).focus(), () => expect(quantity.nth(1)).toBeFocused());
  const outside = page.locator("header a").first();
  await heldChange("5", () => outside.focus(), () => expect(outside).toBeFocused());

  // Bypass browser constraints deliberately: the real server's refusal must be focusable.
  await quantity.first().fill("100");
  await quantity.first().evaluate(input => { input.closest("form")!.noValidate = true; });
  await update.first().focus(); await page.keyboard.press("Enter");
  await expect(page.locator("[data-server-cart] [role=alert]")).toBeFocused();
  await expect(page.locator("[data-guest-cart-count]").first()).toHaveText("6");

  // WebMCP uses the same redraw path; it must keep the current row's keyboard task.
  await quantity.nth(1).focus();
  const changed = await page.evaluate(async () => {
    const actions = (window as unknown as { Dinkus: { actions: {
      getCart(): Promise<{ version: string }>;
      updateCart(input: { version: string; lines: { id: string; quantity: number }[] }): Promise<{ ok: boolean }>;
    } } }).Dinkus.actions;
    const ids = Array.from(document.querySelectorAll("[data-guest-cart-line]"), row => row.getAttribute("data-guest-cart-line")!);
    const cart = await actions.getCart();
    return actions.updateCart({ version: cart.version, lines: ids.map((id, index) => ({ id, quantity: index === 0 ? 6 : 1 })) });
  });
  expect(changed.ok).toBe(true);
  await expect(quantity.first()).toHaveValue("6");
  await expect(quantity.nth(1)).toBeFocused();

  await remove.first().focus(); await page.keyboard.press("Enter");
  await expect(quantity).toHaveCount(1); await expect(remove.first()).toBeFocused();
  await remove.first().press("Enter");
  await expect(page.locator("[data-guest-cart-empty]")).toBeFocused();
  return { inputSubmitFocus: true, buttonSubmitFocus: true, nextTabStaysNearRow: true,
    laterRowFocusWins: true, outsideFocusNotStolen: true, rejectedChangeAlertFocus: true,
    agentRedrawKeepsFocus: true, removalFocus: true, emptyFocus: true };
}
