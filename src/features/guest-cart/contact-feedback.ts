/** Local validation points to the first failing field without changing checkout rules. */
export type CheckoutContactField = "email" | `${"delivery" | "billing"}-${"name" | "line1" | "city" | "postal-code" | "country" | "region"}`;
export type CheckoutContactError = { field: CheckoutContactField; message: string };

/** Clear only our own description token; leave other field guidance intact. */
export function clearCheckoutContactFeedback(root: Element, edited?: Element): void {
  for (const feedback of root.querySelectorAll<HTMLElement>("[data-guest-cart-contact-error]")) {
    const name = feedback.getAttribute("data-guest-cart-contact-error");
    const field = root.querySelector(`[data-guest-cart-${name}]`);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || (edited && edited !== field)) continue;
    if (feedback.hidden) continue;
    feedback.hidden = true;
    feedback.textContent = "";
    field.removeAttribute("aria-invalid");
    const descriptions = (field.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(id => id && id !== feedback.id);
    if (descriptions.length) field.setAttribute("aria-describedby", descriptions.join(" "));
    else field.removeAttribute("aria-describedby");
  }
}

export function setCheckoutContactFeedback(root: Element, error: CheckoutContactError): void {
  clearCheckoutContactFeedback(root);
  const feedback = root.querySelector(`[data-guest-cart-contact-error="${error.field}"]`);
  const field = root.querySelector(`[data-guest-cart-${error.field}]`);
  if (!(feedback instanceof HTMLElement) || !feedback.id || !(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  feedback.textContent = error.message;
  feedback.hidden = false;
  field.setAttribute("aria-invalid", "true");
  const descriptions = new Set((field.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean));
  descriptions.add(feedback.id);
  field.setAttribute("aria-describedby", [...descriptions].join(" "));
  // Only a rejected explicit checkout action moves focus or scrolls the page.
  field.focus();
  field.scrollIntoView({ block: "center" });
}
