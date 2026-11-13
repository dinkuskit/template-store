import { CART_COUNT_COOKIE_NAME } from "./cart-cookie-name.js";
import { GUEST_CART_MAX_QUANTITY } from "./intent.js";
import { installStorefrontWebMcp } from "./webmcp.js";

/**
 * The cart's page script only makes the store faster; every control is a plain form that works without it
 * (template-cart-real-form-20261113). It sends the same forms with fetch and swaps in what the server drew,
 * like Shopify's Section Rendering, and reads the item count from the readable cookie with no request.
 */
const BOUND = Symbol.for("dinkuskit.server-cart.bound");

export function readCartCount(cookie: string = typeof document === "undefined" ? "" : document.cookie): number {
  const match = new RegExp(`(?:^|;\\s*)${CART_COUNT_COOKIE_NAME}=(\\d{1,4})(?:;|$)`, "u").exec(cookie);
  return match ? Number(match[1]) : 0;
}

export function renderCartCount(count = readCartCount()): void {
  for (const badge of document.querySelectorAll<HTMLElement>("[data-guest-cart-count]")) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
  window.dispatchEvent(new CustomEvent("dinkus:cart-count", { detail: { count } }));
}

function setStatus(form: Element, message: string, isError: boolean): void {
  const status = form.closest("[data-add-to-cart-root]")?.querySelector<HTMLElement>("[data-add-to-cart-status]");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.setAttribute("role", isError ? "alert" : "status");
}

async function submitAdd(form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> {
  const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/cart/add.js", {
      method: "POST",
      body: new FormData(form),
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => null) as
      | { ok?: boolean; cart?: { itemCount?: number }; error?: { message?: string } }
      | null;
    if (body?.ok) {
      renderCartCount(typeof body.cart?.itemCount === "number" ? body.cart.itemCount : readCartCount());
      setStatus(form, "Added to your cart.", false);
    } else {
      setStatus(form, body?.error?.message ?? "That cart change could not be made.", true);
    }
  } catch {
    // The network failed: send the plain form, which works without this script.
    form.submit();
  } finally {
    if (button) button.disabled = false;
  }
}

/** Send a cart-page form with fetch and swap in the cart the server drew after the change. */
async function submitChange(form: HTMLFormElement): Promise<void> {
  const section = form.closest("[data-server-cart]");
  if (!section) return form.submit();
  section.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { accept: "text/html" },
      credentials: "same-origin",
    });
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, "text/html").querySelector("[data-server-cart]");
    if (!response.ok || !next) return form.submit();
    section.replaceWith(next);
    renderCartCount();
    next.querySelector<HTMLElement>("[role=alert], [data-guest-cart-empty]")?.focus?.();
  } catch {
    form.submit();
  }
}

/** An agent changed the cart: follow it in the badge and, on the cart page, redraw the cart. */
async function cartChangedElsewhere(count: number): Promise<void> {
  renderCartCount(count);
  const section = document.querySelector("[data-server-cart]");
  if (!section) return;
  try {
    const response = await fetch("/cart", { headers: { accept: "text/html" }, credentials: "same-origin" });
    const next = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("[data-server-cart]");
    if (response.ok && next) section.replaceWith(next);
  } catch {
    // The next visit draws the current cart.
  }
}

function stepQuantity(button: HTMLElement): void {
  const input = button.closest("[data-add-to-cart-root]")?.querySelector<HTMLInputElement>("[data-add-to-cart-qty]");
  if (!input) return;
  const current = Number(input.value);
  const step = Number(button.dataset.addToCartQtyStep ?? "0");
  const next = Number.isSafeInteger(current) ? current + step : 1;
  input.value = String(Math.min(GUEST_CART_MAX_QUANTITY, Math.max(1, next)));
}

export function hydrateServerCartForms(): void {
  const scope = window as unknown as Record<symbol, boolean>;
  renderCartCount();
  if (scope[BOUND]) return;
  scope[BOUND] = true;
  installStorefrontWebMcp({ onCartChanged: (count) => void cartChangedElsewhere(count) });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches("[data-add-to-cart-form]")) {
      event.preventDefault();
      void submitAdd(form, (event as SubmitEvent).submitter ?? null);
    } else if (form.matches("[data-cart-change-form]")) {
      event.preventDefault();
      void submitChange(form);
    }
  });
  document.addEventListener("click", (event) => {
    const step = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-add-to-cart-qty-step]") : null;
    if (step) {
      event.preventDefault();
      stepQuantity(step);
    }
  });
  // Another tab's change shows here once this tab is looked at again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderCartCount();
  });
}
