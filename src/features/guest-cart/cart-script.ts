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

/** What the header's cart link says to a screen reader, whose aria-label hides the badge. */
export function cartNavLabel(count: number): string {
  return count === 0 ? "Cart" : `Cart, ${count} ${count === 1 ? "item" : "items"}`;
}

export function renderCartCount(count = readCartCount()): void {
  for (const link of document.querySelectorAll<HTMLElement>("[data-guest-cart-nav]")) link.setAttribute("aria-label", cartNavLabel(count));
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
    // The answer was lost, so the add may have been saved. Sending it again could add it twice: point to the cart instead.
    setStatus(form, "We could not tell whether that was added. Check your cart before adding it again.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

/** A failed enhancement still uses the captured plain form. */
function submitPlainChange(form: HTMLFormElement): void {
  form.hidden = true;
  document.body.append(form);
  HTMLFormElement.prototype.submit.call(form);
}

/** Keep focus on the same line control; if the line is gone, give the keyboard a useful next stop. */
function replaceCartSection(section: Element, next: Element, beforeLock: Element | null = null): void {
  const active = document.activeElement === document.body ? beforeLock : document.activeElement;
  const line = active?.closest("[data-guest-cart-line]");
  const control = ["data-guest-cart-qty", "data-guest-cart-update", "data-guest-cart-remove"]
    .find((attribute) => active?.hasAttribute(attribute));
  section.replaceWith(next);
  if (!line || !section.contains(line) || !control) return;
  const sameLine = Array.from(next.querySelectorAll("[data-guest-cart-line]"))
    .find((row) => row.getAttribute("data-guest-cart-line") === line.getAttribute("data-guest-cart-line"));
  (sameLine?.querySelector<HTMLElement>(`[${control}]`)
    ?? next.querySelector<HTMLElement>("[data-guest-cart-empty]")
    ?? next.querySelector<HTMLElement>("[data-guest-cart-qty]"))?.focus();
}

/** Send a captured cart-page form and replace the currently attached section. */
async function submitChange(form: HTMLFormElement, focusBeforeLock: () => Element | null): Promise<void> {
  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { accept: "text/html" },
      credentials: "same-origin",
    });
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, "text/html").querySelector("[data-server-cart]");
    if (!response.ok || !next) return submitPlainChange(form);
    const section = document.querySelector("[data-server-cart]");
    if (section) replaceCartSection(section, next, focusBeforeLock());
    renderCartCount();
  } catch {
    submitPlainChange(form);
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
  let savingChange = false;
  let redrawAfterSave = false;

  async function redrawCart(): Promise<void> {
    const section = document.querySelector("[data-server-cart]");
    if (!section) return;
    if (savingChange) {
      redrawAfterSave = true;
      return;
    }
    try {
      const response = await fetch("/cart", { headers: { accept: "text/html" }, credentials: "same-origin" });
      const next = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("[data-server-cart]");
      // A save may have started while the refresh was fetching. Don't replace its locked controls.
      if (savingChange) redrawAfterSave = true;
      else if (response.ok && next) replaceCartSection(section, next);
    } catch {
      // The next visit draws the current cart.
    }
  }

  installStorefrontWebMcp({ onCartChanged: (count) => {
    renderCartCount(count);
    void redrawCart();
  } });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches("[data-add-to-cart-form]")) {
      event.preventDefault();
      void submitAdd(form, (event as SubmitEvent).submitter ?? null);
    } else if (form.matches("[data-cart-change-form]")) {
      if (savingChange) {
        event.preventDefault();
        return;
      }
      const section = document.querySelector("[data-server-cart]");
      if (!section) return; // Let the browser submit the plain form.
      event.preventDefault();
      savingChange = true;
      // Capture before disabling: disabled inputs are not included in form data.
      const captured = form.cloneNode(true) as HTMLFormElement;
      const controls = section.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "[data-cart-change-form] :is([data-guest-cart-qty], button[type=submit]):enabled",
      );
      // Disabling the focused control can move focus to BODY. Keep its place only until another control takes focus.
      let beforeLock = document.activeElement;
      const forgetBeforeLock = () => { beforeLock = null; };
      document.addEventListener("focusin", forgetBeforeLock, { once: true });
      section.setAttribute("aria-busy", "true");
      for (const control of controls) control.disabled = true;
      void submitChange(captured, () => beforeLock).finally(() => {
        document.removeEventListener("focusin", forgetBeforeLock);
        section.removeAttribute("aria-busy");
        for (const control of controls) control.disabled = false;
        savingChange = false;
        if (redrawAfterSave) {
          redrawAfterSave = false;
          void redrawCart();
        }
      });
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
