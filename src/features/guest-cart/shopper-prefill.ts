import {
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_SESSION_HEADER,
  readStoredShopperSession,
  unwrapPluginEnvelope,
} from "../shopper-account/index.js";

function setEmptyFieldValue(root: Element, selector: string, value: string | undefined | null): void {
  if (!value) return;
  const field = root.querySelector(selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  if (field.value.trim().length > 0) return;
  field.value = value;
}

/** Optional defaults, never authority to replace a shopper's checkout draft. */
export async function prefillShopperContact(root: Element): Promise<void> {
  const shopperSession = readStoredShopperSession();
  if (!shopperSession) return;
  setEmptyFieldValue(root, "[data-guest-cart-email]", shopperSession.email);
  try {
    const response = await fetch(SHOPPER_ORDERS_ENDPOINT, {
      method: "GET",
      headers: {
        accept: "application/json",
        [SHOPPER_SESSION_HEADER]: shopperSession.sessionToken,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return;
    const body = unwrapPluginEnvelope(await response.json());
    // A new sign-in, sign-out or expiry can happen while headers or JSON are in
    // flight. Do not mix that earlier account's defaults into the current draft.
    if (readStoredShopperSession()?.sessionToken !== shopperSession.sessionToken) return;
    if (!body || body.ok !== true || typeof body.profile !== "object" || body.profile === null) return;
    const profile = body.profile as {
      email?: string;
      delivery?: {
        name?: string;
        line1?: string;
        line2?: string;
        city?: string;
        region?: string;
        postalCode?: string;
        country?: string;
      } | null;
    };
    setEmptyFieldValue(root, "[data-guest-cart-email]", profile.email);
    const delivery = profile.delivery;
    if (!delivery) return;
    setEmptyFieldValue(root, "[data-guest-cart-delivery-name]", delivery.name);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-line1]", delivery.line1);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-line2]", delivery.line2);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-city]", delivery.city);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-region]", delivery.region);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-postal-code]", delivery.postalCode);
    setEmptyFieldValue(root, "[data-guest-cart-delivery-country]", delivery.country);
  } catch {
    // Best-effort shopper profile prefill; checkout fields remain editable.
  }
}
