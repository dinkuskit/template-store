import { expect, test } from "@playwright/test";

// Deliberately synthetic DOM projections exercise focus destinations without starting a payment.
// Successful real Commerce mutations and keyboard timing are covered by guest-cart.spec.ts.
test("redraw focus handles frozen, expired, unavailable and error projections", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/cart");
  const results = await page.evaluate(async () => {
    const path = "/src/features/guest-cart/cart-redraw-focus.ts";
    const { replaceCartSection } = await import(path);
    const host = document.createElement("div");
    document.body.append(host);
    const title = '<h1 id="fixture-cart-title">Cart</h1>';
    const row = (attributes = "") => `<article data-guest-cart-line="a"><input data-guest-cart-qty value="1" ${attributes}><button data-guest-cart-update ${attributes}>Update</button><button data-guest-cart-remove ${attributes}>Remove</button></article>`;
    const proceed = '<a href="/checkout" data-guest-cart-proceed>Checkout</a>';
    const resume = '<a href="/checkout" data-guest-cart-resume>Resume checkout</a>';
    function check(before: string, after: string, focused: string, expected: string, outside = false) {
      host.innerHTML = `<button id="outside-focus">Outside task</button><section>${title}${before}</section>`;
      const previous = host.querySelector("section")!;
      const active = host.querySelector<HTMLElement>(outside ? "#outside-focus" : focused)!;
      active.focus();
      if (document.activeElement !== active) throw new Error(`Fixture cannot focus ${focused}`);
      const next = document.createElement("section");
      next.innerHTML = title + after;
      replaceCartSection(previous, next);
      return document.activeElement === host.querySelector(expected);
    }
    try {
      return {
        frozenRowToResume: check(row(), row("disabled") + resume, "[data-guest-cart-update]", "[data-guest-cart-resume]"),
        frozenFieldsetToResume: check(row(), `<fieldset disabled>${row()}</fieldset>${resume}`, "[data-guest-cart-qty]", "[data-guest-cart-resume]"),
        thawedResumeToCheckout: check(row("disabled") + resume, row() + proceed, "[data-guest-cart-resume]", "[data-guest-cart-proceed]"),
        unavailableCheckoutToTitle: check(proceed, '<button data-guest-cart-proceed disabled>Unavailable</button>', "[data-guest-cart-proceed]", "h1"),
        noActionToTitle: check(row("disabled") + resume, row() + '<button data-guest-cart-proceed disabled>Unavailable</button>', "[data-guest-cart-resume]", "h1"),
        rejectedChangeToAlert: check(row(), '<p role="alert">Quantity unavailable</p>' + row(), "[data-guest-cart-update]", "[role=alert]"),
        outsideErrorNotStolen: check(row(), '<p role="alert">Quantity unavailable</p>' + row(), "[data-guest-cart-update]", "#outside-focus", true),
        outsideEmptyNotStolen: check(row(), '<p data-guest-cart-empty tabindex="-1">Empty cart</p>', "[data-guest-cart-remove]", "#outside-focus", true),
        hiddenControlSkipped: check(proceed, '<div hidden>' + resume + '</div>' + proceed, "[data-guest-cart-proceed]", "[data-guest-cart-proceed]"),
        inertControlSkipped: check(row(), `<div inert>${row()}</div>${resume}`, "[data-guest-cart-update]", "[data-guest-cart-resume]"),
      };
    } finally { host.remove(); }
  });
  for (const [scenario, passed] of Object.entries(results)) expect(passed, scenario).toBe(true);
});
