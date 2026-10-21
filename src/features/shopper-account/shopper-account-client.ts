import {
  PLAYGROUND_DEMO_SESSION_ENDPOINT,
  SHOPPER_ORDERS_ENDPOINT,
  SHOPPER_PROFILE_ENDPOINT,
  SHOPPER_SESSION_HEADER,
  SHOPPER_SIGN_IN_START_ENDPOINT,
  SHOPPER_SIGN_IN_VERIFY_ENDPOINT,
  SHOPPER_SIGN_OUT_ENDPOINT,
  clearStoredShopperSession,
  formatOrderMoney,
  readStoredShopperSession,
  saveStoredShopperSession,
  unwrapPluginEnvelope,
  type ShopperDeliveryAddress,
  type ShopperOrderItem,
  type ShopperProfile,
  type StoredShopperSession,
} from "./index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVerifiedSessionFromBody(
  body: Record<string, unknown>,
  fallbackEmail: string,
): StoredShopperSession | null {
  if (!isRecord(body.capability)) return null;
  const capability = body.capability;
  const profile = isRecord(body.profile) ? body.profile : null;
  const sessionId = typeof capability.sessionId === "string" ? capability.sessionId : "";
  const sessionToken = typeof capability.session === "string" ? capability.session : "";
  const email =
    typeof profile?.email === "string" && profile.email.trim()
      ? profile.email.trim().toLowerCase()
      : fallbackEmail.trim().toLowerCase();
  const expiresAtIso = typeof capability.expiresAt === "string" ? capability.expiresAt : "";
  const expiresAtMs = Date.parse(expiresAtIso);
  const expiresAt = Number.isFinite(expiresAtMs)
    ? Math.floor(expiresAtMs / 1000)
    : Math.floor(Date.now() / 1000) + 30 * 86_400;
  if (!sessionId || !sessionToken || !email) return null;
  return {
    sessionId,
    sessionToken,
    email,
    expiresAt,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setAccountStatus(root: Element, message: string | null, isError = false): void {
  const status = root.querySelector("[data-account-status]");
  if (!(status instanceof HTMLElement)) return;
  status.hidden = !message;
  status.textContent = message ?? "";
  status.setAttribute("role", isError ? "alert" : "status");
}

function setFieldValue(root: Element, selector: string, value: string): void {
  const el = root.querySelector(selector);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    el.value = value;
  }
}

function readFieldValue(root: Element, selector: string): string {
  const el = root.querySelector(selector);
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value.trim() : "";
}

function populateProfileForm(root: Element, profile: ShopperProfile): void {
  setFieldValue(root, "[data-account-profile-phone]", profile.phone ?? "");
  const delivery = profile.delivery;
  setFieldValue(root, "[data-account-profile-name]", delivery?.name ?? "");
  setFieldValue(root, "[data-account-profile-line1]", delivery?.line1 ?? "");
  setFieldValue(root, "[data-account-profile-line2]", delivery?.line2 ?? "");
  setFieldValue(root, "[data-account-profile-city]", delivery?.city ?? "");
  setFieldValue(root, "[data-account-profile-region]", delivery?.region ?? "");
  setFieldValue(root, "[data-account-profile-postal-code]", delivery?.postalCode ?? "");
  setFieldValue(root, "[data-account-profile-country]", delivery?.country ?? "US");
}

function renderOrderItemMarkup(order: ShopperOrderItem): string {
  const label = order.number !== null ? `Order #${order.number}` : `Order ${order.orderId}`;
  const statusText = order.status === "completed" ? "Completed" : "Processing";
  const paidDate = order.paidAt ? order.paidAt.slice(0, 10) : "Paid";
  const linesMarkup = order.lines
    .map(
      (line) =>
        `<li data-account-order-line="${escapeHtml(line.catalogItemId)}">${escapeHtml(line.name)} × ${line.quantity} — <strong>${escapeHtml(formatOrderMoney(line.unitPrice))}</strong></li>`,
    )
    .join("");
  const delivery = order.delivery;
  const deliveryText = delivery
    ? `${delivery.name}, ${delivery.line1}${delivery.line2 ? `, ${delivery.line2}` : ""}, ${delivery.city}${delivery.region ? `, ${delivery.region}` : ""} ${delivery.postalCode}, ${delivery.country}`
    : "No shipping address recorded";
  return `<article class="account-order-card" data-account-order="${escapeHtml(order.orderId)}">
    <div class="account-order-card__header">
      <h3 data-account-order-number>${escapeHtml(label)}</h3>
      <span class="account-order-card__badge" data-account-order-status="${escapeHtml(order.status)}">${escapeHtml(statusText)}</span>
    </div>
    <p class="account-order-card__meta">Placed <span data-account-order-date>${escapeHtml(paidDate)}</span> · Total <strong data-account-order-total>${escapeHtml(formatOrderMoney(order.total))}</strong></p>
    <ul class="account-order-card__lines">${linesMarkup}</ul>
    <p class="account-order-card__delivery" data-account-order-delivery>Ships to: ${escapeHtml(deliveryText)}</p>
  </article>`;
}

function renderOrders(root: Element, orders: readonly ShopperOrderItem[]): void {
  const list = root.querySelector("[data-account-orders-list]");
  const empty = root.querySelector("[data-account-orders-empty]");
  if (empty instanceof HTMLElement) {
    empty.hidden = orders.length > 0;
  }
  if (list instanceof HTMLElement) {
    if (orders.length === 0) {
      list.replaceChildren();
    } else {
      list.innerHTML = orders.map(renderOrderItemMarkup).join("");
    }
  }
}

function showSignedInState(root: Element, signedIn: boolean, email = ""): void {
  const signedOutSection = root.querySelector("[data-account-signed-out]");
  const signedInSection = root.querySelector("[data-account-signed-in]");
  const emailBadge = root.querySelector("[data-account-current-email]");
  if (signedOutSection instanceof HTMLElement) {
    signedOutSection.hidden = signedIn;
  }
  if (signedInSection instanceof HTMLElement) {
    signedInSection.hidden = !signedIn;
  }
  if (emailBadge instanceof HTMLElement) {
    emailBadge.textContent = email;
  }
}

/** Moves the shopper to the signed-in view so the change is hard to miss. */
function announceSignedIn(root: Element): void {
  const heading = root.querySelector("[data-account-welcome]");
  if (heading instanceof HTMLElement) {
    heading.focus({ preventScroll: true });
  }
  root.scrollIntoView({ block: "start" });
}

async function fetchAccountEndpoint(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(url, init);
  const raw = await response.json().catch(() => null);
  return {
    status: response.status,
    body: unwrapPluginEnvelope(raw),
  };
}

async function loadSignedInDashboard(
  root: Element,
  session: StoredShopperSession,
): Promise<boolean> {
  const headers = {
    accept: "application/json",
    [SHOPPER_SESSION_HEADER]: session.sessionToken,
  };
  const ordersRes = await fetchAccountEndpoint(SHOPPER_ORDERS_ENDPOINT, { method: "GET", headers });
  if (ordersRes.status === 401) {
    clearStoredShopperSession();
    showSignedInState(root, false);
    return false;
  }
  if (
    ordersRes.status !== 200 ||
    !ordersRes.body ||
    ordersRes.body.ok !== true ||
    !isRecord(ordersRes.body.profile)
  ) {
    setAccountStatus(
      root,
      "Could not load your shopper profile right now. Please try again.",
      true,
    );
    return false;
  }
  const rawProfile = ordersRes.body.profile;
  const profile: ShopperProfile = {
    email: typeof rawProfile.email === "string" ? rawProfile.email : session.email,
    phone: typeof rawProfile.phone === "string" ? rawProfile.phone : null,
    delivery: isRecord(rawProfile.delivery)
      ? (rawProfile.delivery as unknown as ShopperDeliveryAddress)
      : null,
  };
  const rawOrders = Array.isArray(ordersRes.body.orders)
    ? (ordersRes.body.orders as ShopperOrderItem[])
    : [];
  showSignedInState(root, true, profile.email);
  populateProfileForm(root, profile);
  renderOrders(root, rawOrders);
  return true;
}

export function hydrateShopperAccountPage(): void {
  const root = document.querySelector("[data-shopper-account]");
  if (!(root instanceof HTMLElement)) return;
  if (root.dataset.accountPreviewUnavailable === "true") return;
  const isPlaygroundMode = root.dataset.playgroundMode === "true";

  const startForm = root.querySelector("[data-account-start-form]");
  const verifyForm = root.querySelector("[data-account-verify-form]");
  const demoButton = root.querySelector("[data-account-demo-signin]");
  const signOutButton = root.querySelector("[data-account-signout]");
  const profileForm = root.querySelector("[data-account-profile-form]");
  const clearProfileButton = root.querySelector("[data-account-profile-clear]");

  const existing = readStoredShopperSession();
  if (existing) {
    void loadSignedInDashboard(root, existing);
  }

  startForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const email = readFieldValue(root, "[data-account-email]");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
        setAccountStatus(root, "Enter a valid email address to continue.", true);
        return;
      }
      const optInBox = root.querySelector("[data-account-opt-in]");
      const optedIn = optInBox instanceof HTMLInputElement ? optInBox.checked : false;
      if (isPlaygroundMode && !optedIn) {
        setAccountStatus(
          root,
          "Check the updates opt-in box to receive a 6-digit email PIN, or use the instant demo account below.",
          true,
        );
        return;
      }
      const startBtn = root.querySelector("[data-account-start]");
      if (startBtn instanceof HTMLButtonElement) startBtn.disabled = true;
      setAccountStatus(root, "Sending 6-digit verification PIN...");
      try {
        const res = await fetchAccountEndpoint(SHOPPER_SIGN_IN_START_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            email,
            ...(isPlaygroundMode ? { optInUpdates: optedIn } : {}),
          }),
        });
        if (res.status !== 200 || !res.body || res.body.ok !== true) {
          const message =
            isRecord(res.body?.error) && typeof res.body.error.message === "string"
              ? res.body.error.message
              : "Could not send a verification code right now.";
          setAccountStatus(root, message, true);
          return;
        }
        if (verifyForm instanceof HTMLElement) {
          verifyForm.hidden = false;
        }
        const codeInput = root.querySelector("[data-account-code]");
        if (codeInput instanceof HTMLInputElement) {
          codeInput.value = "";
          codeInput.focus();
        }
        setAccountStatus(
          root,
          `We sent a 6-digit verification code to ${email.toLowerCase()}. Enter it below within 10 minutes.`,
          false,
        );
      } catch {
        setAccountStatus(root, "Could not reach the store account service.", true);
      } finally {
        if (startBtn instanceof HTMLButtonElement) startBtn.disabled = false;
      }
    })();
  });

  verifyForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const email = readFieldValue(root, "[data-account-email]");
      const code = readFieldValue(root, "[data-account-code]");
      if (!/^\d{6}$/u.test(code)) {
        setAccountStatus(root, "Enter the 6-digit numeric code from your email.", true);
        return;
      }
      const optInBox = root.querySelector("[data-account-opt-in]");
      const optedIn = optInBox instanceof HTMLInputElement ? optInBox.checked : false;
      const verifyBtn = root.querySelector("[data-account-verify]");
      if (verifyBtn instanceof HTMLButtonElement) verifyBtn.disabled = true;
      setAccountStatus(root, "Verifying your 6-digit code...");
      try {
        const res = await fetchAccountEndpoint(SHOPPER_SIGN_IN_VERIFY_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            email,
            code,
            ...(isPlaygroundMode ? { optInUpdates: optedIn } : {}),
          }),
        });
        const stored =
          res.status === 200 && res.body && res.body.ok === true
            ? parseVerifiedSessionFromBody(res.body, email)
            : null;
        if (!stored) {
          const message =
            isRecord(res.body?.error) && typeof res.body.error.message === "string"
              ? res.body.error.message
              : "Invalid or expired verification code.";
          setAccountStatus(root, message, true);
          return;
        }
        if (verifyForm instanceof HTMLElement) verifyForm.hidden = true;
        // Kept only once its profile loads, so a failed or thrown load never
        // leaves a session that shows the same error on every visit.
        if (!(await loadSignedInDashboard(root, stored))) return;
        saveStoredShopperSession(stored);
        setAccountStatus(root, null);
        announceSignedIn(root);
      } catch {
        setAccountStatus(root, "Could not verify your code right now.", true);
      } finally {
        if (verifyBtn instanceof HTMLButtonElement) verifyBtn.disabled = false;
      }
    })();
  });

  demoButton?.addEventListener("click", () => {
    void (async () => {
      if (demoButton instanceof HTMLButtonElement) demoButton.disabled = true;
      setAccountStatus(root, "Starting instant demo shopper session...");
      try {
        const res = await fetchAccountEndpoint(PLAYGROUND_DEMO_SESSION_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({}),
        });
        const stored =
          res.status === 200 && res.body && res.body.ok === true
            ? parseVerifiedSessionFromBody(res.body, "shopper@example.com")
            : null;
        if (!stored) {
          setAccountStatus(root, "Could not start the demo shopper session.", true);
          return;
        }
        if (!(await loadSignedInDashboard(root, stored))) return;
        saveStoredShopperSession(stored);
        setAccountStatus(
          root,
          "Demo account: no PIN required and no email recorded.",
          false,
        );
        announceSignedIn(root);
      } catch {
        setAccountStatus(root, "Could not start the demo shopper session.", true);
      } finally {
        if (demoButton instanceof HTMLButtonElement) demoButton.disabled = false;
      }
    })();
  });

  profileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const session = readStoredShopperSession();
      if (!session) {
        showSignedInState(root, false);
        setAccountStatus(root, "Your session has expired. Sign in again.", true);
        return;
      }
      const phone = readFieldValue(root, "[data-account-profile-phone]");
      const name = readFieldValue(root, "[data-account-profile-name]");
      const line1 = readFieldValue(root, "[data-account-profile-line1]");
      const line2 = readFieldValue(root, "[data-account-profile-line2]");
      const city = readFieldValue(root, "[data-account-profile-city]");
      const region = readFieldValue(root, "[data-account-profile-region]");
      const postalCode = readFieldValue(root, "[data-account-profile-postal-code]");
      const country = readFieldValue(root, "[data-account-profile-country]").toUpperCase();
      const hasDeliveryInput = Boolean(name || line1 || line2 || city || region || postalCode);
      if (hasDeliveryInput && (!name || !line1 || !city || !postalCode || !country)) {
        setAccountStatus(
          root,
          "Complete recipient, address line 1, city, postal code, and country to save your shipping address.",
          true,
        );
        return;
      }
      const delivery = hasDeliveryInput
        ? {
            name,
            line1,
            ...(line2 ? { line2 } : {}),
            city,
            ...(region ? { region } : {}),
            postalCode,
            country,
          }
        : null;
      const saveBtn = root.querySelector("[data-account-profile-save]");
      if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
      try {
        const res = await fetchAccountEndpoint(SHOPPER_PROFILE_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            [SHOPPER_SESSION_HEADER]: session.sessionToken,
          },
          body: JSON.stringify({
            phone: phone || null,
            delivery,
          }),
        });
        if (res.status !== 200 || !res.body || res.body.ok !== true || !isRecord(res.body.profile)) {
          const message =
            isRecord(res.body?.error) && typeof res.body.error.message === "string"
              ? res.body.error.message
              : "Could not save your shipping profile.";
          setAccountStatus(root, message, true);
          return;
        }
        const updated = res.body.profile;
        populateProfileForm(root, {
          email: typeof updated.email === "string" ? updated.email : session.email,
          phone: typeof updated.phone === "string" ? updated.phone : null,
          delivery: isRecord(updated.delivery)
            ? (updated.delivery as unknown as ShopperDeliveryAddress)
            : null,
        });
        setAccountStatus(root, "Saved your default shipping address and contact details.", false);
      } catch {
        setAccountStatus(root, "Could not save your shipping profile right now.", true);
      } finally {
        if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
      }
    })();
  });

  clearProfileButton?.addEventListener("click", () => {
    void (async () => {
      const session = readStoredShopperSession();
      if (!session) return;
      if (clearProfileButton instanceof HTMLButtonElement) clearProfileButton.disabled = true;
      try {
        const res = await fetchAccountEndpoint(SHOPPER_PROFILE_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            [SHOPPER_SESSION_HEADER]: session.sessionToken,
          },
          body: JSON.stringify({ phone: null, delivery: null }),
        });
        if (res.status === 200 && res.body && res.body.ok === true) {
          populateProfileForm(root, { email: session.email, phone: null, delivery: null });
          setAccountStatus(root, "Cleared your saved shipping address and phone number.", false);
        }
      } finally {
        if (clearProfileButton instanceof HTMLButtonElement) clearProfileButton.disabled = false;
      }
    })();
  });

  signOutButton?.addEventListener("click", () => {
    void (async () => {
      const session = readStoredShopperSession();
      if (session) {
        await fetchAccountEndpoint(SHOPPER_SIGN_OUT_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            [SHOPPER_SESSION_HEADER]: session.sessionToken,
          },
          body: JSON.stringify({}),
        }).catch(() => null);
      }
      clearStoredShopperSession();
      showSignedInState(root, false);
      setAccountStatus(root, "Signed out of your shopper account.", false);
    })();
  });
}
