import {
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_SESSION_HEADER,
  readStoredShopperSession,
  unwrapPluginEnvelope,
} from "../shopper-account/index.js";
import { hydrateServerCartForms } from "./cart-script.js";

/**
 * The checkout page is a plain form the server checks and hands to Stripe; this script only hides the billing
 * fields while "same as delivery" is ticked, fills a signed-in shopper's saved address, and stops a second press.
 */
function setEmpty(root: Element, selector: string, value: string | undefined | null): void {
  if (!value) return;
  const field = root.querySelector(selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || field.value.trim()) return;
  field.value = value;
}

async function prefillShopperContact(root: Element): Promise<void> {
  const session = readStoredShopperSession();
  if (!session) return;
  setEmpty(root, "[data-guest-cart-email]", session.email);
  try {
    const response = await fetch(SHOPPER_ORDERS_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json", [SHOPPER_SESSION_HEADER]: session.sessionToken },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return;
    const body = unwrapPluginEnvelope(await response.json());
    const profile = body && body.ok === true && typeof body.profile === "object" ? body.profile as {
      email?: string;
      delivery?: Partial<Record<"name" | "line1" | "line2" | "city" | "region" | "postalCode" | "country", string>> | null;
    } | null : null;
    if (!profile) return;
    setEmpty(root, "[data-guest-cart-email]", profile.email);
    const delivery = profile.delivery;
    if (!delivery) return;
    for (const [field, data] of [["name", "name"], ["line1", "line1"], ["line2", "line2"], ["city", "city"],
      ["region", "region"], ["postalCode", "postal-code"], ["country", "country"]] as const) {
      setEmpty(root, `[data-guest-cart-delivery-${data}]`, delivery[field]);
    }
  } catch {
    // Best-effort; the fields stay editable.
  }
}

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
  void prefillShopperContact(root);
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
