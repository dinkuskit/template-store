import { hydrateServerCartForms } from "./cart-script.js";

/**
 * The checkout page is a plain form the server checks and hands to Stripe; this script only hides the billing
 * fields while "same as delivery" is ticked and stops a second press.
 */
export function renderBilling(root: Element): void {
  const same = root.querySelector("[data-guest-cart-billing-same]");
  const billing = root.querySelector("[data-guest-cart-billing]");
  if (billing instanceof HTMLElement && same instanceof HTMLInputElement) billing.hidden = same.checked;
}

export function hydrateServerCheckout(): void {
  hydrateServerCartForms();
  const root = document.querySelector("[data-server-checkout]");
  if (!root) return;
  renderBilling(root);
  root.querySelector("[data-guest-cart-billing-same]")?.addEventListener("change", () => renderBilling(root));
  // A refused post comes back with its field marked: focus that field, or show the page's own alert.
  const invalidField = root.querySelector<HTMLElement>("[aria-invalid=true]");
  if (invalidField) invalidField.focus();
  else root.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView?.({ block: "center" });
  // Back from Stripe, a browser may restore this page from its cache with the form still marked as sent:
  // load it again so the server draws the checkout as it now stands (a payment to resume, or the form).
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  root.querySelector("[data-checkout-form]")?.addEventListener("submit", (event) => {
    const form = event.currentTarget as HTMLFormElement;
    if (form.dataset.submitting === "true") {
      event.preventDefault();
      return;
    }
    form.dataset.submitting = "true";
    const button = form.querySelector<HTMLButtonElement>("[data-guest-cart-checkout]");
    if (button) button.textContent = "Opening secure checkout…";
  });
}
