/** Local validation belongs beside the contact fields, not above the order summary. */
export function setCheckoutContactFeedback(root: Element, message: string | null): void {
  const feedback = root.querySelector("[data-guest-cart-contact-error]");
  if (!(feedback instanceof HTMLElement)) return;
  feedback.textContent = message ?? "";
  feedback.hidden = !message;
  // Only a rejected explicit checkout action moves focus. Clearing while typing does not.
  if (message) feedback.focus();
}
