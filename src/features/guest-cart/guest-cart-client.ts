import {
  GUEST_CART_STORAGE_KEY,
  addGuestCartLine,
  emptyGuestCartIntent,
  guestCartItemCount,
  guestReturnQueryIsPresent,
  isSafeGuestCartProductId,
  loadGuestCartIntent,
  parseGuestCartQuantityInput,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  readBrowserGuestCartStorage,
  removeGuestCartLine,
  saveGuestCartIntent,
  setGuestCartLineQuantity,
  storageNoticeText,
  checkoutCanConfirm,
  canRetryGuestCheckoutStatus,
  createGuestCheckoutController,
  readGuestCheckoutRetention,
  strictStripeCheckoutUrl,
  settleGuestCheckoutCart,
  type GuestCartCatalogSnapshot,
  type GuestCartIntent,
  type GuestCartReadNotice,
  type GuestCartView,
  type GuestCheckoutTransport,
} from "./index.js";

const SNAPSHOT_TIMEOUT_MS = 5_000;

type Session = {
  intent: GuestCartIntent;
  notice: GuestCartReadNotice | null;
};

let session: Session = { intent: emptyGuestCartIntent(), notice: null };
let snapshots: GuestCartCatalogSnapshot[] | null = null;
let snapshotFailed = false;
let pending = false;
let pendingCheckout = false;
let checkoutRecovery = false;
let checkoutController: ReturnType<typeof createGuestCheckoutController> | null = null;
let checkoutAdmitted = false;
let mutationNotice: string | null = null;
let checkoutMessage: string | null = null;
let checkoutMessageError = false;
let checkoutProbePending = false;

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
    snapshotFailed,
    storageNotice: session.notice,
    checkoutAdmitted,
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

function lineCopyMarkup(line: GuestCartView["lines"][number]): string {
  return `<h2>${escapeText(line.name)}</h2>
  ${line.sku ? `<p data-guest-cart-sku>SKU: ${escapeText(line.sku)}</p>` : ""}
  ${priceMarkup(line)}
  ${line.availabilityLabel ? `<p data-commerce-availability>${escapeText(line.availabilityLabel)}</p>` : ""}
  ${line.reason ? `<p data-guest-cart-line-reason="${escapeText(line.reasonCode ?? "")}">${escapeText(line.reason)}</p>` : ""}`;
}

function lineMarkup(line: GuestCartView["lines"][number], current: GuestCartView): string {
  const pendingAttr = current.pending ? " aria-busy=\"true\"" : "";
  return `<article data-guest-cart-line="${escapeText(line.id)}"${pendingAttr}>
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
  if (retry instanceof HTMLElement) retry.focus();
  void removedId;
}

function renderCart(root: Element): void {
  const current = view();
  const empty = root.querySelector("[data-guest-cart-empty]");
  const lines = root.querySelector("[data-guest-cart-lines]");
  const checkout = root.querySelector("[data-guest-cart-checkout]");
  const coupon = root.querySelector("[data-guest-cart-coupon]");
  const reason = root.querySelector("[data-guest-cart-checkout-reason]");
  const retry = root.querySelector("[data-guest-cart-retry]");
  const checkoutRecoveryButton = root.querySelector("[data-guest-cart-recover]");
  if (empty instanceof HTMLElement) {
    empty.hidden = !current.empty || Boolean(current.snapshotError);
  }
  if (lines instanceof HTMLElement) {
    if (current.empty) lines.replaceChildren();
    else reconcileLines(lines, current);
  }
  if (checkout instanceof HTMLButtonElement) {
    checkout.disabled = !current.checkoutEnabled || checkoutLocked();
    checkout.textContent = current.checkoutLabel;
  }
  if (coupon instanceof HTMLInputElement) {
    coupon.disabled = !checkoutAdmitted || checkoutLocked();
  }
  if (reason instanceof HTMLElement) {
    reason.textContent = current.checkoutReason;
  }
  if (retry instanceof HTMLButtonElement) {
    retry.disabled = current.pending;
  }
  if (checkoutRecoveryButton instanceof HTMLButtonElement) {
    checkoutRecoveryButton.hidden = !checkoutRecovery;
    checkoutRecoveryButton.disabled = pendingCheckout;
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

async function probeGuestCheckout(root: Element): Promise<void> {
  // A closed server admission must not trigger a proactive prepare attempt.
  // Recovery remains separate and can still query a retained paid checkout.
  if (
    !checkoutController ||
    !checkoutAdmitted ||
    checkoutProbePending ||
    session.intent.lines.length === 0
  ) return;
  const retention = readGuestCheckoutRetention(checkoutStorage());
  if (
    retention &&
    !checkoutController.canPrepareNew() &&
    !checkoutController.canStart()
  ) {
    return;
  }
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

async function recoverGuestCheckout(root: Element): Promise<void> {
  if (!checkoutController || pendingCheckout) return;
  pendingCheckout = true;
  checkoutRecovery = true;
  renderCart(root);
  const response = await checkoutController.status();
  if (response.failure || !response.result) {
    pendingCheckout = false;
    setCheckoutMessage(checkoutFailureText(response.failure), true);
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
  } else if (checkoutController.canStart()) {
    setCheckoutMessage("No checkout has started. You can continue to checkout.");
  } else {
    setCheckoutMessage("Checkout is still pending. Check status before trying again.");
  }
  pendingCheckout = false;
  renderCart(root);
}

async function refreshSnapshot(root?: Element): Promise<void> {
  if (pending) return;
  if (session.intent.lines.length === 0) {
    snapshots = [];
    snapshotFailed = false;
    pending = false;
    if (root) renderCart(root);
    else renderNav();
    return;
  }
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
    if (root) renderCart(root);
    else renderNav();
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

export function hydrateGuestCartControls(): void {
  session = loadSession();
  renderNav();
  document.querySelectorAll("[data-add-to-cart]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.guestCartReady === "1") return;
    button.dataset.guestCartReady = "1";
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-add-to-cart");
      if (!isSafeGuestCartProductId(id)) return;
      button.disabled = true;
      const status = button.parentElement?.querySelector("[data-add-to-cart-status]");
      const result = addGuestCartLine(session.intent, id, 1);
      if (!result.accepted) {
        if (status instanceof HTMLElement) {
          status.hidden = false;
          status.textContent = result.reason ?? "The product could not be added.";
          status.setAttribute("role", "alert");
        }
        button.disabled = false;
        return;
      }
      applyIntent(result.intent, session.notice);
      document.dispatchEvent(new CustomEvent("guest-cart-updated"));
      if (status instanceof HTMLElement) {
        status.hidden = false;
        if (persistFailed()) {
          status.textContent = storageNoticeText(session.notice) ?? "The cart could not be saved.";
          status.setAttribute("role", "alert");
        } else {
          status.textContent = "Added to cart.";
          status.setAttribute("role", "status");
        }
      }
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
  checkoutRecovery = Boolean(readGuestCheckoutRetention(checkoutStorage()));
  checkoutMessage = checkoutRecovery ? "You have a saved checkout. Check its status before trying again." : null;
  checkoutMessageError = false;
  checkoutProbePending = false;
  snapshots = null;
  const retry = root.querySelector("[data-guest-cart-retry]");
  retry?.addEventListener("click", () => {
    if (pending) return;
    void refreshSnapshot(root);
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-guest-cart-checkout]")) {
      if (!checkoutController || checkoutLocked() || !view().checkoutEnabled) return;
      const originalIntent = structuredClone(session.intent);
      const couponInput = root.querySelector("[data-guest-cart-coupon]");
      const couponCode = couponInput instanceof HTMLInputElement ? couponInput.value.trim() || undefined : undefined;
      pendingCheckout = true;
      checkoutRecovery = false;
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
        const started = await checkoutController!.start(originalIntent, couponCode);
        pendingCheckout = false;
        if (started.failure || !started.result || !started.result.ok) {
          checkoutRecovery = Boolean(readGuestCheckoutRetention(checkoutStorage()));
          setCheckoutMessage(checkoutFailureText(started.failure), true);
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
  void (async () => {
    if (readGuestCheckoutRetention(checkoutStorage())?.cartSettlement) {
      await recoverGuestCheckout(root);
    }
    await probeGuestCheckout(root);
  })();
}

function checkoutStorage() {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    globalThis.localStorage.getItem("dinkus.guest-checkout.probe");
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function hydrateGuestCheckoutReturn(): void {
  const root = document.querySelector("[data-guest-checkout-return]");
  if (!(root instanceof HTMLElement)) return;
  const status = root.querySelector("[data-guest-checkout-return-status]");
  const order = root.querySelector("[data-guest-checkout-order]");
  const retry = root.querySelector("[data-guest-checkout-retry]");
  const statusRetry = root.querySelector("[data-guest-checkout-status-retry]");
  const retention = readGuestCheckoutRetention(checkoutStorage());
  const setMessage = (message: string, error = false) => {
    if (!(status instanceof HTMLElement)) return;
    status.hidden = false;
    status.textContent = message;
    status.setAttribute("role", error ? "alert" : "status");
  };
  if (!retention) {
    setMessage("This return could not be matched to a saved checkout. No purchase was confirmed.", true);
    if (statusRetry instanceof HTMLButtonElement) statusRetry.disabled = true;
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
      setMessage("Status checks are temporarily limited. No purchase was confirmed.", true);
      updateRetryAvailability();
      return;
    }
    checking = true;
    if (statusRetry instanceof HTMLButtonElement) statusRetry.disabled = true;
    if (retry instanceof HTMLAnchorElement) retry.hidden = true;
    setMessage("Checking the saved checkout status.");
    statusChecks += 1;
    const { result, failure } = await controller.status();
    if (failure || !result) {
      setMessage("Checkout status could not be confirmed. Retry when you are back online.", true);
      finishCheck();
      return;
    }
    if (result.ok && checkoutCanConfirm(result)) {
      if (order instanceof HTMLElement) {
        order.hidden = false;
        order.textContent = `Order confirmed: ${result.checkout.order!.orderId}. Receipt: ${result.checkout.order!.receiptId}.`;
      }
      if (retry instanceof HTMLAnchorElement) retry.hidden = true;
      const settled = await settleGuestCheckoutCart(checkoutStorage(), result);
      session = loadSession();
      renderNav();
      setMessage(settled ? "Order confirmed." : "Order confirmed. Your cart could not be updated. Check status again.", !settled);
      finishCheck();
      return;
    }
    const redirect = result.ok ? strictStripeCheckoutUrl(result.checkout.redirectUrl) : null;
    if (redirect && retry instanceof HTMLAnchorElement &&
        result.ok && result.checkout.state !== "released-retry") {
      retry.hidden = false;
      retry.href = redirect;
    }
    const message = result.ok && result.checkout.state === "released-retry"
      ? "Commerce released the original attempt. Return to the cart to start again."
      : result.ok && result.checkout.state === "pending"
        ? "Checkout is still pending with Commerce. Check status again before retrying."
        : "Commerce has not confirmed a paid order. The original checkout remains protected.";
    setMessage(message, result.ok && result.checkout.state !== "pending");
    finishCheck();
  };
  statusRetry?.addEventListener("click", () => void checkStatus());
  void checkStatus();
}
