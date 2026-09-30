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
  type GuestCartCatalogSnapshot,
  type GuestCartIntent,
  type GuestCartReadNotice,
  type GuestCartView,
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
let mutationNotice: string | null = null;

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
  const reason = root.querySelector("[data-guest-cart-checkout-reason]");
  const retry = root.querySelector("[data-guest-cart-retry]");
  if (empty instanceof HTMLElement) {
    empty.hidden = !current.empty || Boolean(current.snapshotError);
  }
  if (lines instanceof HTMLElement) {
    if (current.empty) lines.replaceChildren();
    else reconcileLines(lines, current);
  }
  if (checkout instanceof HTMLButtonElement) {
    checkout.disabled = true;
    checkout.textContent = current.checkoutLabel;
  }
  if (reason instanceof HTMLElement) {
    reason.textContent = current.checkoutReason;
  }
  if (retry instanceof HTMLButtonElement) {
    retry.disabled = current.pending;
  }
  const messages = [
    current.storageNotice,
    mutationNotice,
    current.pending ? "Updating current product details." : null,
    current.snapshotError,
  ].filter((message): message is string => Boolean(message));
  setStatus(root, messages[0] ?? null, Boolean(current.snapshotError || current.storageNotice || mutationNotice));
  renderNav();
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
  snapshots = null;
  const retry = root.querySelector("[data-guest-cart-retry]");
  retry?.addEventListener("click", () => {
    if (pending) return;
    void refreshSnapshot(root);
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const removeId = target.getAttribute("data-guest-cart-remove");
    if (!removeId) return;
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
  if (guestReturnQueryIsPresent(window.location.search)) {
    mutationNotice = null;
  }
  renderCart(root);
  void refreshSnapshot(root);
}
