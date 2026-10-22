import {
  GUEST_CART_PROCEED_LABEL,
  GUEST_CART_STORAGE_KEY,
  addGuestCartLine,
  addGuestCartLines,
  emptyGuestCartIntent,
  guestCartItemCount,
  guestReturnQueryIsPresent,
  isSafeGuestCartProductId,
  isSafeOrderLineImageUrl,
  loadGuestCartIntent,
  parseGuestCartBatchSelections,
  parseGuestCartQuantityInput,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  presentGuestCheckoutBreakdown,
  readBrowserGuestCartStorage,
  admitPlaygroundStoreStorage,
  removeGuestCartLine,
  saveGuestCartIntent,
  setGuestCartLineQuantity,
  stepGuestCartQuantityInput,
  storageNoticeText,
  guestCartRetryControlState,
  checkoutCanConfirm,
  canRetryGuestCheckoutStatus,
  createGuestCheckoutController,
  GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY,
  readGuestCheckoutRetention,
  strictStripeCheckoutUrl,
  guestCheckoutRetryUrl,
  settleGuestCheckoutCart,
  type GuestCartCatalogSnapshot,
  type GuestCartIntent,
  type GuestCartReadNotice,
  type GuestCartView,
  type GuestCheckoutContact,
  type GuestCheckoutDelivery,
  type GuestCheckoutOrderLine,
  type GuestCheckoutRetention,
  type GuestCheckoutShippingPolicyInput,
  type GuestCheckoutTransport,
  type GuestCheckoutWireResult,
} from "./index.js";
import {
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_SESSION_HEADER,
  readStoredShopperSession,
  unwrapPluginEnvelope,
} from "../shopper-account/index.js";

// A live store's price check took up to 4.7 s on beta; leave room above that.
const SNAPSHOT_TIMEOUT_MS = 15_000;

type Session = {
  intent: GuestCartIntent;
  notice: GuestCartReadNotice | null;
};

let session: Session = { intent: emptyGuestCartIntent(), notice: null };
let snapshots: GuestCartCatalogSnapshot[] | null = null;
let snapshotFailed = false;
let pending = false;
let retrying = false;
let pendingCheckout = false;
let checkoutRecovery = false;
let checkoutController: ReturnType<typeof createGuestCheckoutController> | null = null;
let checkoutAdmitted = false;
let mutationNotice: string | null = null;
let checkoutMessage: string | null = null;
let checkoutMessageError = false;
let checkoutProbePending = false;
// Commerce's open hosted-checkout session, offered after a status check says pending.
let checkoutResumeUrl: string | null = null;

function checkoutLocked(): boolean {
  return pendingCheckout || checkoutProbePending || Boolean(readGuestCheckoutRetention(checkoutStorage()) &&
    !checkoutController?.canStart() && !checkoutController?.canPrepareNew());
}

function setCheckoutMessage(message: string, isError = false): void {
  checkoutMessage = message;
  checkoutMessageError = isError;
}

function storage() {
  return readBrowserGuestCartStorage();
}

function persist(intent: GuestCartIntent, notice: GuestCartReadNotice | null): Session {
  const saved = saveGuestCartIntent(GUEST_CART_STORAGE_KEY, intent, storage());
  return {
    intent: saved.intent,
    notice: saved.notice ?? (saved.persisted ? null : notice),
  };
}

function loadSession(): Session {
  const loaded = loadGuestCartIntent(GUEST_CART_STORAGE_KEY, storage());
  return { intent: loaded.intent, notice: loaded.notice };
}

function view(): GuestCartView {
  return presentGuestCart({
    intent: session.intent,
    snapshots,
    pending,
    retrying,
    snapshotFailed,
    storageNotice: session.notice,
    checkoutAdmitted: checkoutAdmitted || Boolean(checkoutController?.canStart()),
  });
}

function setStatus(root: Element, message: string | null, isError = false): void {
  const status = root.querySelector("[data-guest-cart-status]");
  if (!(status instanceof HTMLElement)) return;
  status.hidden = !message;
  status.textContent = message ?? "";
  status.setAttribute("role", isError ? "alert" : "status");
}

function renderNav(): void {
  const count = guestCartItemCount(session.intent);
  for (const link of document.querySelectorAll("[data-guest-cart-nav]")) {
    if (!(link instanceof HTMLElement)) continue;
    const label = count === 0 ? "Cart" : `Cart, ${count} ${count === 1 ? "item" : "items"}`;
    link.setAttribute("aria-label", label);
    const badge = link.querySelector("[data-guest-cart-count]");
    if (badge instanceof HTMLElement) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
  }
}

function priceMarkup(line: GuestCartView["lines"][number]): string {
  if (line.saleText && line.regularText) {
    return `<p class="price"><s data-regular-price>${escapeText(line.regularText)}</s><strong data-sale-price>${escapeText(line.saleText)}</strong></p>`;
  }
  if (line.regularText) {
    return `<p class="price"><strong data-regular-price>${escapeText(line.regularText)}</strong></p>`;
  }
  return "";
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inputValue(root: Element, selector: string): string {
  const input = root.querySelector(selector);
  return input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input.value.trim() : "";
}

function setEmptyFieldValue(root: Element, selector: string, value: string | undefined | null): void {
  if (!value) return;
  const field = root.querySelector(selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  if (field.value.trim().length > 0) return;
  field.value = value;
}

async function prefillShopperContact(root: Element): Promise<void> {
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

export function readCheckoutContact(
  root: Element,
  needsDelivery: boolean,
): { contact: GuestCheckoutContact | null; error: string | null } {
  const email = inputValue(root, "[data-guest-cart-email]");
  if (!email) return { contact: null, error: "Enter your email address to continue." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return { contact: null, error: "Enter a valid email address to continue." };
  }
  // A digital-only cart hides the delivery section; values left there from an
  // earlier physical cart must never reach Commerce or block checkout.
  if (!needsDelivery) return { contact: { email }, error: null };
  const fields = {
    name: inputValue(root, "[data-guest-cart-delivery-name]"),
    line1: inputValue(root, "[data-guest-cart-delivery-line1]"),
    line2: inputValue(root, "[data-guest-cart-delivery-line2]"),
    city: inputValue(root, "[data-guest-cart-delivery-city]"),
    region: inputValue(root, "[data-guest-cart-delivery-region]"),
    postalCode: inputValue(root, "[data-guest-cart-delivery-postal-code]"),
    country: inputValue(root, "[data-guest-cart-delivery-country]").toUpperCase(),
  };
  const deliveryEntered = Object.values(fields).some(Boolean);
  if (!deliveryEntered) return { contact: { email }, error: null };
  for (const [key, value] of Object.entries(fields)) {
    if (!value && key !== "line2" && key !== "region") {
      return { contact: null, error: "Complete the recipient, address, city, postal code, and country fields." };
    }
  }
  if (!/^[A-Z]{2}$/u.test(fields.country)) {
    return { contact: null, error: "Choose a country this store ships to." };
  }
  if (fields.country === "US" && !fields.region) {
    return { contact: null, error: "Enter a state for United States delivery." };
  }
  const delivery = {
    name: fields.name,
    line1: fields.line1,
    ...(fields.line2 ? { line2: fields.line2 } : {}),
    city: fields.city,
    ...(fields.region ? { region: fields.region } : {}),
    postalCode: fields.postalCode,
    country: fields.country,
  };
  return { contact: { email, delivery }, error: null };
}

function lineThumbnailMarkup(line: GuestCartView["lines"][number]): string {
  if (!line.thumbnail) return `<p data-guest-cart-thumbnail-placeholder>No image</p>`;
  return `<img data-guest-cart-thumbnail-img src="${escapeText(line.thumbnail.src)}" alt="${escapeText(line.thumbnail.alt)}" width="160" height="120" loading="lazy" />`;
}

function lineCopyMarkup(line: GuestCartView["lines"][number]): string {
  return `<h2>${escapeText(line.name)}</h2>
  ${line.sku ? `<p data-guest-cart-sku>SKU: ${escapeText(line.sku)}</p>` : ""}
  ${priceMarkup(line)}
  ${line.lineTotalText ? `<p data-guest-cart-line-total>Line total <strong>${escapeText(line.lineTotalText)}</strong></p>` : ""}
  ${line.availabilityLabel ? `<p data-commerce-availability>${escapeText(line.availabilityLabel)}</p>` : ""}
  ${line.reason ? `<p data-guest-cart-line-reason="${escapeText(line.reasonCode ?? "")}">${escapeText(line.reason)}</p>` : ""}`;
}

function lineMarkup(line: GuestCartView["lines"][number], current: GuestCartView): string {
  const pendingAttr = current.pending ? " aria-busy=\"true\"" : "";
  return `<article data-guest-cart-line="${escapeText(line.id)}"${pendingAttr}>
  <div class="guest-cart-line-media" data-guest-cart-line-thumbnail data-guest-cart-line-media>${lineThumbnailMarkup(line)}</div>
  <div data-guest-cart-line-copy>${lineCopyMarkup(line)}</div>
  <div class="guest-cart-qty">
    <label for="guest-cart-qty-${escapeText(line.id)}">Quantity</label>
    <input id="guest-cart-qty-${escapeText(line.id)}" data-guest-cart-qty="${escapeText(line.id)}" type="text" inputmode="numeric" value="${line.quantity}" />
  </div>
  <button type="button" data-guest-cart-remove="${escapeText(line.id)}">Remove</button>
</article>`;
}

function lineSelector(id: string): string {
  return `[data-guest-cart-line="${CSS.escape(id)}"]`;
}

function patchLine(article: HTMLElement, line: GuestCartView["lines"][number], current: GuestCartView): void {
  if (current.pending) article.setAttribute("aria-busy", "true");
  else article.removeAttribute("aria-busy");
  const thumbnail = article.querySelector("[data-guest-cart-line-thumbnail]");
  if (thumbnail instanceof HTMLElement) {
    const img = thumbnail.querySelector("img");
    const stale = line.thumbnail
      ? !(img instanceof HTMLImageElement) ||
        img.getAttribute("src") !== line.thumbnail.src ||
        img.getAttribute("alt") !== line.thumbnail.alt
      : img !== null || !thumbnail.querySelector("[data-guest-cart-thumbnail-placeholder]");
    if (stale) {
      thumbnail.innerHTML = lineThumbnailMarkup(line);
    }
  }
  const copy = article.querySelector("[data-guest-cart-line-copy]");
  if (copy instanceof HTMLElement) copy.innerHTML = lineCopyMarkup(line);
  const input = article.querySelector("[data-guest-cart-qty]");
  if (input instanceof HTMLInputElement && document.activeElement !== input) {
    input.value = String(line.quantity);
  }
}

function reconcileLines(container: HTMLElement, current: GuestCartView): void {
  const keep = new Set(current.lines.map((line) => line.id));
  for (const child of [...container.children]) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute("data-guest-cart-line");
    if (!id || !keep.has(id)) child.remove();
  }
  for (const line of current.lines) {
    const existing = container.querySelector(lineSelector(line.id));
    if (existing instanceof HTMLElement) {
      patchLine(existing, line, current);
      container.append(existing);
      continue;
    }
    container.insertAdjacentHTML("beforeend", lineMarkup(line, current));
  }
}

function focusAfterRemove(root: Element, removedId: string): void {
  const nextInput = root.querySelector("[data-guest-cart-qty]");
  if (nextInput instanceof HTMLElement) {
    nextInput.focus();
    return;
  }
  const empty = root.querySelector("[data-guest-cart-empty]");
  if (empty instanceof HTMLElement && !empty.hidden) {
    empty.focus();
    return;
  }
  const retry = root.querySelector("[data-guest-cart-retry]");
  if (retry instanceof HTMLElement && !retry.hidden) retry.focus();
  void removedId;
}

function renderCart(root: Element): void {
  const current = view();
  const isCheckoutPage = root.hasAttribute("data-guest-checkout-page");
  const empty = root.querySelector("[data-guest-cart-empty]");
  const lines = root.querySelector("[data-guest-cart-lines]");
  const checkout = root.querySelector("[data-guest-cart-checkout]");
  const contact = root.querySelector("[data-guest-cart-contact]");
  const reason = root.querySelector("[data-guest-cart-checkout-reason]");
  const delivery = root.querySelector("[data-guest-cart-delivery]");
  const retry = root.querySelector("[data-guest-cart-retry]");
  const checkoutRecoveryButton = root.querySelector("[data-guest-cart-recover]");
  const checkoutResume = root.querySelector("[data-guest-cart-resume]");
  const manifest = root.querySelector("[data-checkout-manifest]");
  const breakdown = root.querySelector("[data-checkout-breakdown]");
  if (empty instanceof HTMLElement) {
    empty.hidden = !current.empty || Boolean(current.snapshotError);
  }
  if (lines instanceof HTMLElement) {
    if (current.empty) lines.replaceChildren();
    else reconcileLines(lines, current);
  }
  const subtotal = root.querySelector("[data-guest-cart-subtotal]");
  if (subtotal instanceof HTMLElement) {
    subtotal.hidden = current.empty || !current.subtotalText;
    const amount = subtotal.querySelector("[data-guest-cart-subtotal-amount]");
    if (amount instanceof HTMLElement) amount.textContent = current.subtotalText ?? "";
  }
  if (manifest instanceof HTMLElement) {
    manifest.hidden = current.empty;
  }
  if (breakdown instanceof HTMLElement) {
    breakdown.hidden = current.empty;
    const shippingMode = root.getAttribute("data-checkout-shipping-mode");
    const shippingMinor = root.getAttribute("data-checkout-shipping-minor");
    const shippingPolicy: GuestCheckoutShippingPolicyInput | null =
      shippingMode === "free" || shippingMode === "flat"
        ? { mode: shippingMode, flatRateMinor: shippingMinor }
        : null;
    const breakdownView = presentGuestCheckoutBreakdown({
      intent: session.intent,
      snapshots,
      snapshotFailed,
      retrying,
      shippingPolicy,
    });
    const shippingAmount = breakdown.querySelector("[data-checkout-shipping-amount]");
    if (shippingAmount instanceof HTMLElement) {
      shippingAmount.textContent = breakdownView.shippingText;
    }
    const taxAmount = breakdown.querySelector("[data-checkout-tax-amount]");
    if (taxAmount instanceof HTMLElement) {
      taxAmount.textContent = breakdownView.taxText;
    }
    const totalAmount = breakdown.querySelector("[data-checkout-total-amount]");
    if (totalAmount instanceof HTMLElement) {
      totalAmount.textContent = breakdownView.totalText;
    }
  }
  if (checkout instanceof HTMLButtonElement) {
    checkout.disabled = !current.checkoutEnabled || checkoutLocked();
    checkout.textContent = !isCheckoutPage && current.checkoutEnabled
      ? GUEST_CART_PROCEED_LABEL
      : current.checkoutLabel;
  }
  if (contact instanceof HTMLFieldSetElement) {
    contact.disabled = !(checkoutAdmitted || checkoutController?.canStart()) || checkoutLocked();
  }
  if (reason instanceof HTMLElement) {
    reason.textContent = current.checkoutReason;
  }
  if (delivery instanceof HTMLElement) {
    delivery.hidden = !current.needsDelivery;
  }
  if (retry instanceof HTMLButtonElement) {
    const retryState = guestCartRetryControlState(current);
    retry.hidden = retryState.hidden;
    retry.disabled = retryState.disabled;
  }
  if (checkoutRecoveryButton instanceof HTMLButtonElement) {
    checkoutRecoveryButton.hidden = !checkoutRecovery;
    checkoutRecoveryButton.disabled = pendingCheckout;
  }
  if (checkoutResume instanceof HTMLAnchorElement) {
    checkoutResume.hidden = !checkoutResumeUrl || pendingCheckout;
    if (checkoutResumeUrl) checkoutResume.href = checkoutResumeUrl;
    else checkoutResume.removeAttribute("href");
  }
  for (const control of root.querySelectorAll("[data-guest-cart-qty], [data-guest-cart-remove]")) {
    if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
      control.disabled = checkoutLocked();
    }
  }
  const messages = [
    pendingCheckout ? "Checking your checkout." : checkoutMessage,
    current.storageNotice,
    mutationNotice,
    current.pending ? "Updating current product details." : null,
    current.snapshotError,
  ].filter((message): message is string => Boolean(message));
  setStatus(root, messages[0] ?? null, checkoutMessage ? checkoutMessageError : Boolean(current.snapshotError || current.storageNotice || mutationNotice));
  renderNav();
}

function checkoutFailureText(failure: string | null): string {
  if (failure === "timeout" || failure === "network") {
    return "Checkout start may have reached Commerce. Check status before trying again.";
  }
  if (failure === "association" || failure === "attempt-active") {
    return "This checkout is still tied to the original attempt. Check status before retrying.";
  }
  return "Checkout is not available yet. Try again when Commerce is available.";
}

function checkoutStatusFailureText(code?: string): string {
  const references: Record<string, string> = {
    CHECKOUT_STATUS_HOST_ORIGIN: "status-host-origin",
    CHECKOUT_STATUS_ORIGIN_DENIED: "status-origin",
    CHECKOUT_STATUS_CAPABILITY_DENIED: "status-capability",
    CHECKOUT_STATUS_NOT_FOUND: "status-not-found",
    CHECKOUT_STATUS_UNAVAILABLE: "status-unavailable",
    CHECKOUT_STATUS_UPSTREAM_REDIRECT: "status-upstream-redirect",
    CHECKOUT_STATUS_UPSTREAM_HTTP: "status-upstream-http",
    CHECKOUT_STATUS_RESPONSE_INVALID: "status-response",
    CHECKOUT_STATUS_FETCH_FAILED: "status-fetch",
  };
  const http = code?.match(/^CHECKOUT_STATUS_UPSTREAM_HTTP_([45][0-9]{2})$/u);
  const reference = http && http[0] === code
    ? `status-upstream-http-${http[1]}`
    : code && Object.hasOwn(references, code) ? references[code] : undefined;
  return "Checkout status is unavailable. Your existing checkout remains protected." +
    (reference ? ` Reference: ${reference}.` : "");
}

function commerceErrorText(error: { code: string; message: string; reason?: string; minimum?: { currency: string; minor: string } }): string {
  if (error.code !== "COUPON_UNAVAILABLE") return error.message;
  const wording: Record<string, string> = {
    "not-found": "That coupon code isn't valid.",
    "not-started": "That coupon isn't active yet.",
    expired: "That coupon has expired.",
    "no-qualifying-items": "That coupon doesn't apply to the items in your cart.",
    "used-up": "That coupon has been fully used.",
    "try-later": "We can't check coupons right now. Try again, or remove the coupon.",
    "not-applicable": "That coupon can't be used for this order.",
  };
  if (error.reason === "minimum-not-met" && error.minimum?.currency === "USD") {
    const minor = Number(error.minimum.minor);
    if (Number.isSafeInteger(minor) && minor >= 0) {
      return `Spend $${(minor / 100).toFixed(2)} on qualifying items to use this coupon.`;
    }
  }
  return wording[error.reason ?? ""] ?? "That coupon can't be used for this order.";
}

async function probeGuestCheckout(root: Element): Promise<void> {
  // A closed server admission must not trigger a proactive prepare attempt.
  // Recovery remains separate and can still query a retained paid checkout.
  if (
    !checkoutController ||
    !checkoutAdmitted ||
    checkoutProbePending ||
    session.intent.lines.length === 0
  ) return;
  // A startable capability needs no new one, and a retained one that cannot
  // prepare new stays with its status check; prepare() would only refuse.
  if (checkoutController.canStart()) return;
  if (readGuestCheckoutRetention(checkoutStorage()) && !checkoutController.canPrepareNew()) return;
  checkoutProbePending = true;
  checkoutMessage = "Checking Commerce checkout availability.";
  checkoutMessageError = false;
  renderCart(root);
  const prepared = await checkoutController.prepare();
  checkoutProbePending = false;
  if (prepared.result?.ok) {
    checkoutMessage = null;
    checkoutMessageError = false;
  } else {
    checkoutAdmitted = false;
    checkoutMessage = checkoutFailureText(prepared.failure);
    checkoutMessageError = true;
  }
  renderCart(root);
}

// A quiet check is the cart's own reload check of a capability this browser
// only prepared: when Commerce says nothing started, the cart simply unlocks.
async function recoverGuestCheckout(root: Element, quiet = false): Promise<void> {
  if (!checkoutController || pendingCheckout) return;
  pendingCheckout = true;
  checkoutRecovery = !quiet;
  checkoutResumeUrl = null;
  renderCart(root);
  const response = await checkoutController.status();
  if (response.failure || !response.result || !response.result.ok) {
    pendingCheckout = false;
    checkoutRecovery = true;
    setCheckoutMessage(checkoutStatusFailureText(
      response.result && !response.result.ok ? response.result.error.code : undefined,
    ), true);
    renderCart(root);
    return;
  }
  checkoutRecovery = !response.result.ok ||
    (response.result.checkout.state !== "paid" &&
      response.result.checkout.state !== "released-retry");
  if (response.result.ok && checkoutCanConfirm(response.result)) {
    const settled = await settleGuestCheckoutCart(checkoutStorage(), response.result);
    session = loadSession();
    checkoutRecovery = !settled;
    setCheckoutMessage(settled ? "Order confirmed." : "Order confirmed. Your cart could not be updated. Check status again.", !settled);
  } else if (response.result.ok && response.result.checkout.state === "released-retry") {
    setCheckoutMessage("The original attempt was released. You can try checkout again.");
  } else if (checkoutController.canStart() && quiet) {
    checkoutRecovery = false;
    checkoutMessage = null;
    checkoutMessageError = false;
  } else if (checkoutController.canStart()) {
    setCheckoutMessage("No checkout has started. You can continue to checkout.");
  } else {
    // A shopper who backed out of Stripe lands here; paying on the open
    // session finishes this same attempt, so it cannot charge twice.
    checkoutResumeUrl = guestCheckoutRetryUrl(response.result);
    setCheckoutMessage(checkoutResumeUrl
      ? "Your checkout is still open. Return to secure checkout to finish paying."
      : "Checkout is still pending. Check status before trying again.");
  }
  pendingCheckout = false;
  renderCart(root);
}

async function refreshSnapshot(root?: Element): Promise<void> {
  if (pending) return;
  if (session.intent.lines.length === 0) {
    snapshots = [];
    snapshotFailed = false;
    retrying = false;
    pending = false;
    if (root) renderCart(root);
    else renderNav();
    return;
  }
  const retryBtn = root?.querySelector("[data-guest-cart-retry]");
  const retryHadFocus = Boolean(
    retryBtn && (document.activeElement === retryBtn || retryBtn.contains(document.activeElement)),
  );
  retrying = snapshotFailed || retrying;
  pending = true;
  snapshotFailed = false;
  if (root) renderCart(root);
  else renderNav();
  try {
    const ids = session.intent.lines.map((line) => line.id).join(",");
    const response = await fetch(`/api/guest-cart/snapshot?ids=${encodeURIComponent(ids)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("snapshot-http");
    const parsed = parseGuestCartSnapshotResponse(await response.json());
    if (!parsed) throw new Error("snapshot-shape");
    snapshots = parsed;
    snapshotFailed = false;
  } catch {
    snapshotFailed = true;
  } finally {
    pending = false;
    retrying = false;
    if (root) {
      renderCart(root);
      if (retryHadFocus && snapshotFailed) {
        const retry = root.querySelector("[data-guest-cart-retry]");
        if (retry instanceof HTMLElement && !retry.hidden && !("disabled" in retry && retry.disabled)) {
          retry.focus();
        }
      }
    } else {
      renderNav();
    }
  }
}

function applyIntent(next: GuestCartIntent, notice: GuestCartReadNotice | null, root?: Element): void {
  session = persist(next, notice);
  if (root) renderCart(root);
  renderNav();
}

function persistFailed(): boolean {
  return session.notice === "storage-write-failed" || session.notice === "storage-unavailable";
}

function setAddToCartStatus(container: Element | null | undefined, message: string, isError: boolean): void {
  const status = container?.querySelector("[data-add-to-cart-status]");
  if (!(status instanceof HTMLElement)) return;
  status.hidden = false;
  status.textContent = message;
  status.setAttribute("role", isError ? "alert" : "status");
}

function commitAddToCartMutation(
  container: Element | null | undefined,
  result: ReturnType<typeof addGuestCartLine>,
): boolean {
  if (!result.accepted) {
    setAddToCartStatus(container, result.reason ?? "The product could not be added.", true);
    return false;
  }
  applyIntent(result.intent, session.notice);
  document.dispatchEvent(new CustomEvent("guest-cart-updated"));
  if (persistFailed()) {
    setAddToCartStatus(
      container,
      storageNoticeText(session.notice) ?? "The cart could not be saved.",
      true,
    );
  } else {
    setAddToCartStatus(container, "Added to cart.", false);
  }
  return true;
}

function readVariantBatchInputs(container: Element | null | undefined): HTMLInputElement[] {
  if (!container) return [];
  return [...container.querySelectorAll("[data-variant-qty]")].filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement && !node.disabled,
  );
}

function runVariantBatchAdd(container: Element | null | undefined, button: HTMLButtonElement): void {
  button.disabled = true;
  const inputs = readVariantBatchInputs(container);
  const parsed = parseGuestCartBatchSelections(
    inputs.map((input) => ({
      id: input.getAttribute("data-variant-qty") ?? "",
      rawQuantity: input.value,
    })),
  );
  if (parsed.reason !== null) {
    setAddToCartStatus(container, parsed.reason, true);
    button.disabled = false;
    return;
  }
  if (commitAddToCartMutation(container, addGuestCartLines(session.intent, parsed.lines))) {
    for (const input of inputs) {
      input.value = "0";
    }
  }
  button.disabled = false;
}

function isSingleAddBlocked(button: HTMLButtonElement, container: Element | null | undefined): boolean {
  if (button.disabled || button.hidden) return true;
  if (button.getAttribute("data-add-to-cart-sellable") === "false") return true;
  const single = button.closest("[data-add-to-cart-single]");
  if (single instanceof HTMLElement && single.hidden) return true;
  if (container instanceof HTMLElement && container.hidden) return true;
  if (button.closest("[hidden]") !== null) return true;
  return false;
}

let hydrateListenerRegistered = false;

export function hydrateGuestCartControls(): void {
  session = loadSession();
  renderNav();
  if (!hydrateListenerRegistered && typeof document.addEventListener === "function") {
    hydrateListenerRegistered = true;
    document.addEventListener("dinkus:guest-cart-hydrate", () => {
      hydrateGuestCartControls();
    });
  }
  document.querySelectorAll("[data-add-to-cart-qty-step]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.guestCartStepReady === "1") return;
    button.dataset.guestCartStepReady = "1";
    button.addEventListener("click", () => {
      const container = button.closest(".guest-cart-add") ?? button.parentElement;
      const input = container?.querySelector("[data-add-to-cart-qty]");
      if (!(input instanceof HTMLInputElement) || input.disabled) return;
      const delta = button.getAttribute("data-add-to-cart-qty-step") === "-1" ? -1 : 1;
      input.value = String(stepGuestCartQuantityInput(input.value, delta, 1));
    });
  });
  document.querySelectorAll("[data-variant-qty-step]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.guestCartStepReady === "1") return;
    button.dataset.guestCartStepReady = "1";
    button.addEventListener("click", () => {
      const container = button.closest(".guest-cart-add") ?? button.parentElement;
      const targetId = button.getAttribute("data-variant-qty-target");
      const row = button.closest("[data-variant-batch-row]") ?? button.parentElement;
      const input =
        (targetId ? container?.querySelector(`[data-variant-qty="${CSS.escape(targetId)}"]`) : null) ??
        row?.querySelector("[data-variant-qty]");
      if (!(input instanceof HTMLInputElement) || input.disabled) return;
      const delta = button.getAttribute("data-variant-qty-step") === "-1" ? -1 : 1;
      input.value = String(stepGuestCartQuantityInput(input.value, delta, 0));
    });
  });
  document.querySelectorAll("[data-add-to-cart-batch]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.guestCartBatchReady === "1") return;
    button.dataset.guestCartBatchReady = "1";
    button.addEventListener("click", () => {
      const container = button.closest(".guest-cart-add") ?? button.parentElement;
      runVariantBatchAdd(container, button);
    });
  });
  document.querySelectorAll("[data-add-to-cart]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.guestCartReady === "1") return;
    button.dataset.guestCartReady = "1";
    button.addEventListener("click", () => {
      const container = button.closest(".guest-cart-add") ?? button.parentElement;
      if (isSingleAddBlocked(button, container)) return;
      const id = button.getAttribute("data-add-to-cart");
      if (!isSafeGuestCartProductId(id)) return;
      button.disabled = true;
      const qtyInput = container?.querySelector("[data-add-to-cart-qty]");
      let quantity = 1;
      if (qtyInput instanceof HTMLInputElement) {
        const parsed = parseGuestCartQuantityInput(qtyInput.value.trim());
        if (parsed === null) {
          setAddToCartStatus(container, "Quantity must be a whole number from 1 to 99.", true);
          button.disabled = false;
          return;
        }
        quantity = parsed;
      }
      commitAddToCartMutation(container, addGuestCartLine(session.intent, id, quantity));
      button.disabled = false;
    });
  });
}

export function hydrateGuestCartPage(): void {
  const root = document.querySelector("[data-guest-cart]");
  if (!(root instanceof HTMLElement)) return;
  session = loadSession();
  checkoutAdmitted = root.dataset.guestCheckoutAdmitted === "true";
  checkoutController = createGuestCheckoutController({
    // Capability preparation does not establish readiness. The server's
    // registry/catalog admission is the only browser-facing admission input.
    admitted: checkoutAdmitted,
    storage: checkoutStorage(),
    transport: {
      fetch: (input: string, init: RequestInit) => fetch(input, init),
    } satisfies GuestCheckoutTransport,
  });
  pendingCheckout = false;
  const initialRetention = readGuestCheckoutRetention(checkoutStorage());
  // start() marks awaitingStart before it sends, so a retention with neither an
  // attempt nor that mark was only prepared here. The cart checks its status on
  // load by itself; anything else waits for the shopper's status check.
  const preparedOnly = Boolean(initialRetention && initialRetention.attemptId === null &&
    !initialRetention.awaitingStart && !initialRetention.cartSettlement);
  checkoutRecovery = Boolean(initialRetention) && !preparedOnly;
  checkoutMessage = checkoutRecovery ? "Check checkout status before continuing." : null;
  checkoutMessageError = false;
  checkoutProbePending = false;
  checkoutResumeUrl = null;
  snapshots = null;
  const retry = root.querySelector("[data-guest-cart-retry]");
  retry?.addEventListener("click", () => {
    if (pending) return;
    retrying = true;
    void refreshSnapshot(root);
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-guest-cart-checkout]")) {
      if (!checkoutController || checkoutLocked() || !view().checkoutEnabled) return;
      if (!root.hasAttribute("data-guest-checkout-page")) {
        window.location.assign("/checkout");
        return;
      }
      const originalIntent = structuredClone(session.intent);
      const contactInput = readCheckoutContact(root, view().needsDelivery);
      if (contactInput.error || !contactInput.contact) {
        setCheckoutMessage(contactInput.error ?? "Complete the checkout contact fields.", true);
        renderCart(root);
        return;
      }
      // Coupons are coming soon: Registry Commerce refuses every code for v1,
      // so checkout never sends one. COUPON_UNAVAILABLE stays handled below.
      const couponCode = undefined;
      pendingCheckout = true;
      checkoutRecovery = false;
      checkoutResumeUrl = null;
      checkoutMessage = null;
      renderCart(root);
      const needsPreparation = !readGuestCheckoutRetention(checkoutStorage()) || checkoutController.canPrepareNew();
      const preparation = needsPreparation ? checkoutController.prepare() : Promise.resolve(null);
      void preparation.then(async (prepared) => {
        if (prepared && (prepared.failure || !prepared.result || !prepared.result.ok)) {
          pendingCheckout = false;
          checkoutRecovery = Boolean(readGuestCheckoutRetention(checkoutStorage()));
          setCheckoutMessage(checkoutFailureText(prepared.failure), true);
          renderCart(root);
          return;
        }
        const started = await checkoutController!.start(originalIntent, couponCode, contactInput.contact!);
        pendingCheckout = false;
        if (started.failure || !started.result || !started.result.ok) {
          checkoutRecovery = Boolean(readGuestCheckoutRetention(checkoutStorage()));
          setCheckoutMessage(
            started.result && !started.result.ok ? commerceErrorText(started.result.error) : checkoutFailureText(started.failure),
            true,
          );
          renderCart(root);
          return;
        }
        if (started.result.ok) {
          const redirect = strictStripeCheckoutUrl(started.result.checkout.redirectUrl);
          if (redirect && started.result.checkout.state === "pending") {
            window.location.assign(redirect);
            return;
          }
          checkoutRecovery = true;
          setCheckoutMessage("Checkout is pending. Check status before trying again.");
          renderCart(root);
          if (started.result.checkout.state === "paid") void recoverGuestCheckout(root);
        }
      });
      return;
    }
    if (target.closest("[data-guest-cart-recover]")) {
      void recoverGuestCheckout(root);
      return;
    }
    const removeId = target.getAttribute("data-guest-cart-remove");
    if (!removeId) return;
    if (checkoutLocked()) return;
    const result = removeGuestCartLine(session.intent, removeId);
    if (!result.accepted) {
      mutationNotice = result.reason;
      renderCart(root);
      return;
    }
    mutationNotice = null;
    applyIntent(result.intent, session.notice, root);
    focusAfterRemove(root, removeId);
    void refreshSnapshot(root);
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (checkoutLocked()) return;
    const id = target.getAttribute("data-guest-cart-qty");
    if (!id) return;
    const quantity = parseGuestCartQuantityInput(target.value);
    if (quantity === null) {
      mutationNotice = "Quantity must be a whole number from 1 to 99.";
      setStatus(root, mutationNotice, true);
      return;
    }
    const result = setGuestCartLineQuantity(session.intent, id, quantity);
    if (!result.accepted) {
      mutationNotice = result.reason;
      setStatus(root, mutationNotice, true);
      return;
    }
    mutationNotice = null;
    applyIntent(result.intent, session.notice, root);
  });
  document.addEventListener("guest-cart-updated", () => void probeGuestCheckout(root));
  if (guestReturnQueryIsPresent(window.location.search)) {
    mutationNotice = null;
  }
  renderCart(root);
  void refreshSnapshot(root);
  if (root.querySelector("[data-guest-cart-email]")) {
    void prefillShopperContact(root);
  }
  void (async () => {
    if (readGuestCheckoutRetention(checkoutStorage())?.cartSettlement) {
      await recoverGuestCheckout(root);
    } else if (preparedOnly) {
      await recoverGuestCheckout(root, true);
    }
    await probeGuestCheckout(root);
  })();
}

function checkoutStorage() {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    globalThis.localStorage.getItem("dinkus.guest-checkout.probe");
    return admitPlaygroundStoreStorage(globalThis.localStorage) ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function resolveOrderLineThumbnail(
  line: Pick<GuestCheckoutOrderLine, "id" | "name" | "sku" | "imageUrl" | "imageAlt">,
  snapshotById?: ReadonlyMap<string, GuestCartCatalogSnapshot>,
): { src: string; alt: string } | null {
  const defaultAlt = `${line.name ?? line.id} thumbnail`;
  if (isSafeOrderLineImageUrl(line.imageUrl)) {
    return {
      src: line.imageUrl.trim(),
      alt: line.imageAlt ?? defaultAlt,
    };
  }
  const snapshot = snapshotById?.get(line.id);
  const snapThumb = snapshot?.found ? snapshot.thumbnail : null;
  if (snapThumb && isSafeOrderLineImageUrl(snapThumb.src)) {
    return {
      src: snapThumb.src.trim(),
      alt: line.imageAlt ?? snapThumb.alt ?? defaultAlt,
    };
  }
  return null;
}

export function formatConfirmedDeliveryAddress(delivery: GuestCheckoutDelivery): string {
  const locality = [delivery.city, delivery.region, delivery.postalCode].filter(Boolean).join(" ");
  return [delivery.line1, delivery.line2, locality, delivery.country].filter(Boolean).join(", ");
}

function formatCheckoutMoneyValue(value: { currency: string; minor: string }): string | null {
  const minor = Number(value.minor);
  if (!Number.isSafeInteger(minor)) return null;
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: value.currency,
    }).format(amount);
  } catch {
    return `${value.currency} ${amount.toFixed(2)}`;
  }
}

export type ConfirmedOrderDestination = Readonly<{
  email: string | null;
  recipient: string | null;
  address: string | null;
  delivery: GuestCheckoutDelivery | null;
  shippingMethod: string | null;
}>;

export function resolveConfirmedOrderDestination(
  result: GuestCheckoutWireResult,
  retention?: GuestCheckoutRetention | null,
): ConfirmedOrderDestination | null {
  if (!result.ok || !checkoutCanConfirm(result) || !result.checkout.order) return null;
  const order = result.checkout.order;
  const email = order.contact?.email ?? result.checkout.contact?.email ?? retention?.contact?.email ?? null;
  const delivery = order.delivery ??
    order.contact?.delivery ??
    result.checkout.delivery ??
    result.checkout.contact?.delivery ??
    retention?.contact?.delivery ??
    null;
  const recipient = delivery?.name ?? null;
  const address = delivery ? formatConfirmedDeliveryAddress(delivery) : null;
  const checkoutRecord = result.checkout as unknown as Record<string, unknown>;
  const pricing = checkoutRecord.pricing && typeof checkoutRecord.pricing === "object"
    ? checkoutRecord.pricing as Record<string, unknown>
    : null;
  const shippingObj = pricing?.shipping && typeof pricing.shipping === "object"
    ? pricing.shipping as Record<string, unknown>
    : null;
  const chargeObj = shippingObj?.charge && typeof shippingObj.charge === "object"
    ? shippingObj.charge as Record<string, unknown>
    : null;
  const shippingChargeText = chargeObj &&
    typeof chargeObj.currency === "string" &&
    typeof chargeObj.minor === "string" &&
    /^-?\d+$/u.test(chargeObj.minor)
    ? formatCheckoutMoneyValue({ currency: chargeObj.currency, minor: chargeObj.minor })
    : null;
  const shippingMode = typeof shippingObj?.mode === "string" ? shippingObj.mode : null;
  const explicitShippingMethod = order.shippingMethod ?? result.checkout.shippingMethod ?? null;
  const derivedShippingMethod = explicitShippingMethod ??
    (shippingMode === "free"
      ? "Free shipping"
      : shippingMode === "flat"
        ? (shippingChargeText ? `Flat rate (${shippingChargeText})` : "Flat rate shipping")
        : (delivery && shippingChargeText
          ? (chargeObj?.minor === "0" ? "Free shipping" : `Standard shipping (${shippingChargeText})`)
          : null));
  if (!email && !recipient && !address && !derivedShippingMethod) return null;
  return {
    email,
    recipient,
    address,
    delivery,
    shippingMethod: derivedShippingMethod,
  };
}

export function confirmedOrderMarkup(
  root: HTMLElement,
  result: GuestCheckoutWireResult,
  retention?: GuestCheckoutRetention | null,
  snapshotById?: ReadonlyMap<string, GuestCartCatalogSnapshot>,
): void {
  if (!result.ok || !checkoutCanConfirm(result)) return;
  const order = result.checkout.order!;
  const orderNumber = root.querySelector("[data-guest-checkout-order-number]");
  if (orderNumber instanceof HTMLElement) {
    orderNumber.textContent = `Order ${order.orderId.replace(/^order:/u, "")}`;
  }
  const testBadge = root.querySelector("[data-guest-checkout-test]");
  if (testBadge instanceof HTMLElement) {
    testBadge.hidden = order.test !== true;
  }
  const items = root.querySelector("[data-guest-checkout-order-items]");
  if (items instanceof HTMLElement) {
    items.replaceChildren(...order.lines.map((line) => {
      const row = document.createElement("li");
      row.className = "guest-checkout-item";
      row.dataset.guestCheckoutItem = line.id;
      if (line.sku) row.dataset.guestCheckoutItemSku = line.sku;
      const resolvedThumb = resolveOrderLineThumbnail(line, snapshotById);
      if (resolvedThumb) {
        const thumb = document.createElement("img");
        thumb.className = "guest-checkout-item-thumb";
        thumb.setAttribute("data-guest-checkout-item-thumb", "");
        thumb.setAttribute("data-guest-checkout-item-thumbnail", "");
        thumb.src = resolvedThumb.src;
        thumb.alt = resolvedThumb.alt;
        thumb.width = 56;
        thumb.height = 56;
        thumb.loading = "lazy";
        thumb.decoding = "async";
        row.append(thumb);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "guest-checkout-item-thumb guest-checkout-item-thumb--placeholder";
        placeholder.setAttribute("data-guest-checkout-item-thumb-placeholder", "");
        placeholder.textContent = "No image";
        row.append(placeholder);
      }
      const label = document.createElement("span");
      label.className = "guest-checkout-item-details";
      label.setAttribute("data-guest-checkout-item-details", "");
      label.textContent = `${line.name ?? line.id} \u00d7 ${line.quantity}`;
      if (line.variant) {
        const variant = document.createElement("small");
        variant.className = "guest-checkout-item-variant";
        variant.setAttribute("data-guest-checkout-item-variant", "");
        variant.textContent = line.variant;
        label.append(variant);
      }
      row.append(label);
      const amount = document.createElement("span");
      amount.className = "guest-checkout-item-amount";
      amount.setAttribute("data-guest-checkout-item-amount", "");
      const unitMinor = line.unitPrice && /^-?\d+$/u.test(line.unitPrice.minor)
        ? Number(line.unitPrice.minor)
        : NaN;
      const minor = Number.isSafeInteger(unitMinor) && Number.isSafeInteger(unitMinor * line.quantity)
        ? unitMinor * line.quantity
        : null;
      amount.textContent = minor === null || !line.unitPrice
        ? ""
        : formatCheckoutMoneyValue({ currency: line.unitPrice.currency, minor: String(minor) }) ?? "";
      row.append(amount);
      return row;
    }));
  }
  const destinationSection = root.querySelector("[data-guest-checkout-destination]");
  if (destinationSection instanceof HTMLElement) {
    const destination = resolveConfirmedOrderDestination(result, retention);
    destinationSection.hidden = !destination;
    const bindField = (rowSelector: string, valueSelector: string, text: string | null) => {
      const rowEl = destinationSection.querySelector(rowSelector);
      const valEl = destinationSection.querySelector(valueSelector);
      if (rowEl instanceof HTMLElement) rowEl.hidden = !text;
      if (valEl instanceof HTMLElement) valEl.textContent = text ?? "";
    };
    bindField("[data-guest-checkout-email-row]", "[data-guest-checkout-email]", destination?.email ?? null);
    bindField("[data-guest-checkout-recipient-row]", "[data-guest-checkout-recipient]", destination?.recipient ?? null);
    bindField("[data-guest-checkout-address-row]", "[data-guest-checkout-address]", destination?.address ?? null);
    bindField(
      "[data-guest-checkout-shipping-method-row]",
      "[data-guest-checkout-shipping-method]",
      destination?.shippingMethod ?? null,
    );
  }
  const totals = root.querySelector("[data-guest-checkout-order-totals]");
  if (!(totals instanceof HTMLElement)) return;
  const checkout = result.checkout as unknown as Record<string, unknown>;
  const pricing = checkout.pricing && typeof checkout.pricing === "object"
    ? checkout.pricing as Record<string, unknown>
    : null;
  const total = order.total ?? checkout.total;
  const money = (value: unknown, freeShipping = false): string | null => {
    if (!value || typeof value !== "object") return null;
    const minor = (value as Record<string, unknown>).minor;
    const currency = (value as Record<string, unknown>).currency;
    if (typeof minor !== "string" || !/^-?\d+$/u.test(minor) || typeof currency !== "string") return null;
    if (freeShipping && minor === "0") return "Free";
    return formatCheckoutMoneyValue({ currency, minor });
  };
  const rows: Array<[string, unknown]> = [
    ["Subtotal", pricing?.merchandiseSubtotal],
    ["Shipping", pricing?.shipping && typeof pricing.shipping === "object"
      ? (pricing.shipping as Record<string, unknown>).charge
      : undefined],
    ["Tax", pricing?.tax ?? pricing?.taxTotal],
    ["Total", total],
  ];
  totals.replaceChildren(...rows.flatMap(([label, value]) => {
    const formatted = money(value, label === "Shipping");
    if (!formatted) return [];
    const row = document.createElement("div");
    if (label === "Total") row.className = "total";
    const term = document.createElement("dt");
    term.textContent = label;
    const amount = document.createElement("dd");
    amount.textContent = formatted;
    row.append(term, amount);
    return [row];
  }));
}

export function hydrateGuestCheckoutReturn(): void {
  const root = document.querySelector("[data-guest-checkout-return]");
  if (!(root instanceof HTMLElement)) return;
  const status = root.querySelector("[data-guest-checkout-return-status]");
  const order = root.querySelector("[data-guest-checkout-order]");
  const initialContact = root.querySelector("[data-guest-checkout-contact]");
  const retry = root.querySelector("[data-guest-checkout-retry]");
  const statusRetry = root.querySelector("[data-guest-checkout-status-retry]");
  const retention = readGuestCheckoutRetention(checkoutStorage());
  const storedCheckoutData = (() => {
    const saved = checkoutStorage();
    if (!saved) return undefined;
    try {
      return saved.getItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY);
    } catch {
      return "";
    }
  })();
  const failureMessage = root.querySelector("[data-guest-checkout-contact]")
    ? "We couldn't confirm your order just now. Check your email, or contact us."
    : "We couldn't confirm your order just now. Check your email.";
  const setFailureState = () => {
    const title = root.querySelector("#guest-checkout-return-title");
    if (title instanceof HTMLElement) title.textContent = "We couldn't confirm your order";
    setMessage(failureMessage, false);
    if (statusRetry instanceof HTMLButtonElement) statusRetry.hidden = true;
  };
  const setMessage = (message: string, error = false) => {
    if (!(status instanceof HTMLElement)) return;
    status.hidden = false;
    status.textContent = message;
    status.setAttribute("role", error ? "alert" : "status");
  };
  if (!retention && storedCheckoutData === null) {
    setFailureState();
    return;
  }
  if (!retention) {
    setFailureState();
    return;
  }
  const controller = createGuestCheckoutController({
    admitted: false,
    storage: checkoutStorage(),
    transport: {
      fetch: (input: string, init: RequestInit) => fetch(input, init),
    } satisfies GuestCheckoutTransport,
  });
  let checking = false;
  let statusChecks = 0;
  const updateRetryAvailability = () => {
    if (statusRetry instanceof HTMLButtonElement) {
      statusRetry.disabled = !canRetryGuestCheckoutStatus(statusChecks);
    }
  };
  const finishCheck = () => {
    checking = false;
    updateRetryAvailability();
  };
  const checkStatus = async () => {
    if (checking) return;
    if (!canRetryGuestCheckoutStatus(statusChecks)) {
      setFailureState();
      updateRetryAvailability();
      return;
    }
    checking = true;
    if (statusRetry instanceof HTMLButtonElement) statusRetry.disabled = true;
    if (retry instanceof HTMLAnchorElement) retry.hidden = true;
    setMessage("Checking the saved checkout status.");
    statusChecks += 1;
    const { result, failure } = await controller.status();
    const exhausted = !canRetryGuestCheckoutStatus(statusChecks);
    if (failure || !result) {
      setFailureState();
      finishCheck();
      return;
    }
    if (!result.ok) {
      setFailureState();
      finishCheck();
      return;
    }
    if (result.ok && checkoutCanConfirm(result)) {
      if (order instanceof HTMLElement) {
        order.hidden = false;
        const currentRetention = readGuestCheckoutRetention(checkoutStorage()) ?? retention;
        confirmedOrderMarkup(root, result, currentRetention);
        const missingMediaIds = result.checkout.order
          ? [...new Set(
              result.checkout.order.lines
                .filter((line) => !isSafeOrderLineImageUrl(line.imageUrl) && isSafeGuestCartProductId(line.id))
                .map((line) => line.id),
            )]
          : [];
        if (missingMediaIds.length > 0) {
          void (async () => {
            try {
              const snapshotResponse = await fetch(
                `/api/guest-cart/snapshot?ids=${encodeURIComponent(missingMediaIds.join(","))}`,
                { headers: { accept: "application/json" }, signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) },
              );
              if (!snapshotResponse.ok) return;
              const parsedSnapshots = parseGuestCartSnapshotResponse(await snapshotResponse.json());
              if (!parsedSnapshots) return;
              const byId = new Map(parsedSnapshots.map((entry) => [entry.id, entry]));
              confirmedOrderMarkup(root, result, currentRetention, byId);
            } catch {
              // Keep the neutral "No image" placeholder when catalog lookup fails.
            }
          })();
        }
      }
      if (initialContact instanceof HTMLElement) initialContact.hidden = true;
      if (retry instanceof HTMLAnchorElement) retry.hidden = true;
      if (statusRetry instanceof HTMLButtonElement) statusRetry.hidden = true;
      const settled = await settleGuestCheckoutCart(checkoutStorage(), result);
      session = loadSession();
      renderNav();
      setMessage(settled
        ? "Order confirmed."
        : exhausted
          ? "Order confirmed. Your cart could not be updated."
          : "Order confirmed. Your cart could not be updated. Check status again.", !settled);
      finishCheck();
      return;
    }
    const redirect = guestCheckoutRetryUrl(result);
    if (redirect && retry instanceof HTMLAnchorElement) {
      retry.hidden = false;
      retry.href = redirect;
    }
    const message = result.ok && result.checkout.state === "released-retry"
      ? "Commerce released the original attempt. Return to the cart to start again."
      : result.ok && result.checkout.state === "pending"
        ? "Checkout is still pending with Commerce. Check status again before retrying."
        : "Commerce has not confirmed a paid order. The original checkout remains protected.";
    setMessage(message, result.ok && result.checkout.state !== "pending");
    if (statusRetry instanceof HTMLButtonElement) {
      statusRetry.hidden = !(result.ok && result.checkout.state === "pending");
    }
    if (exhausted && result.ok && result.checkout.state === "pending") {
      setFailureState();
      setMessage(
        "Status checks are temporarily limited. Check your confirmation email or refresh later.",
        true,
      );
      if (statusRetry instanceof HTMLButtonElement) statusRetry.hidden = false;
    }
    finishCheck();
  };
  statusRetry?.addEventListener("click", () => void checkStatus());
  void checkStatus();
}
