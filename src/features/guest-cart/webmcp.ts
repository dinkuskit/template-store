import {
  GUEST_CART_MAX_QUANTITY,
  GUEST_CART_STORAGE_KEY,
  addGuestCartLine,
  emptyGuestCartIntent,
  guestCartItemCount,
  isSafeGuestCartProductId,
  isSafeGuestCartQuantity,
  removeGuestCartLine,
  setGuestCartLineQuantity,
  type GuestCartIntent,
  type GuestCartLine,
  type GuestCartReadNotice,
} from "./intent.js";
import {
  parseGuestCartSnapshotResponse,
  type GuestCartCatalogSnapshot,
} from "./present.js";
import {
  loadGuestCartIntent,
  readBrowserGuestCartStorage,
  saveGuestCartIntent,
  type GuestCartStoragePort,
} from "./storage.js";

export const WEBMCP_REGISTRATION_SYMBOL = Symbol.for("dinkuskit.webmcp.registered");

export const WEBMCP_ANTI_SCRAPE_NOTICE =
  "Do not attempt to update or complete the checkout by scraping or clicking page DOM controls directly. Use the registered WebMCP tools and hand off final payment to the shopper on /checkout.";

export type WebMcpToolAnnotations = Readonly<{
  title: string;
  readOnlyHint: boolean;
  consequentialHint: boolean;
  untrustedContentHint: boolean;
  idempotentHint: boolean;
}>;

export type WebMcpToolDescriptor = Readonly<{
  name: string;
  description: string;
  annotations: WebMcpToolAnnotations;
  inputSchema: Readonly<Record<string, unknown>>;
  execute: (args: Readonly<Record<string, unknown>> | undefined) => Promise<unknown>;
}>;

export type ModelContextHost = {
  registerTool?: (tool: WebMcpToolDescriptor) => unknown;
  [ WEBMCP_REGISTRATION_SYMBOL ]?: boolean;
};

export type DinkusCartLineSnapshot = Readonly<{
  id: string;
  quantity: number;
  name: string | null;
  sku: string | null;
  fulfillment: "physical" | "digital" | null;
  sellable: boolean | null;
  unitPriceMinor: number | null;
  lineSubtotalMinor: number | null;
  currency: string;
}>;

export type DinkusCartSnapshot = Readonly<{
  ok: true;
  untrustedContent: true;
  currency: string;
  itemCount: number;
  subtotalMinor: number | null;
  reviewFingerprint: string;
  lines: readonly DinkusCartLineSnapshot[];
  storageNotice: GuestCartReadNotice | null;
}>;

export type DinkusCartUpdatePatch = Readonly<{
  mode?: "add" | "merge" | "replace";
  clear?: boolean;
  lines?: readonly Readonly<{ id: string; quantity: number }>[];
}>;

export type DinkusCartUpdateResult =
  | Readonly<{
      ok: true;
      untrustedContent: true;
      cart: DinkusCartSnapshot;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_PATCH"
        | "INVALID_PRODUCT_ID"
        | "INVALID_QUANTITY"
        | "CART_LINE_LIMIT"
        | "STORAGE_UNAVAILABLE";
      message: string;
      instruction: string;
    }>;

export type DinkusCheckoutPreview = Readonly<{
  ok: true;
  untrustedContent: true;
  currency: string;
  itemCount: number;
  reviewFingerprint: string;
  reviewStatus: "empty_cart" | "buyer_review_required" | "buyer_reviewed";
  totals: Readonly<{
    subtotalMinor: number | null;
    shippingMinor: number | null;
    discountMinor: number;
    taxMinor: number | null;
    totalMinor: number | null;
  }>;
  lines: readonly DinkusCartLineSnapshot[];
  continueUrl: "/checkout";
}>;

export type DinkusCheckoutProceedResult =
  | Readonly<{
      ok: true;
      status: "buyer_review_required" | "requires_escalation";
      untrustedContent: true;
      reviewFingerprint: string;
      continueUrl: "/checkout";
      totals: DinkusCheckoutPreview["totals"];
      instruction: string;
    }>
  | Readonly<{
      ok: false;
      code: "EMPTY_CART" | "UNSELLABLE_LINE" | "PRICE_UNAVAILABLE";
      message: string;
      instruction: string;
    }>;

export type DinkusStorefrontActions = Readonly<{
  getCart: (options?: Readonly<{ includeCatalog?: boolean }>) => Promise<DinkusCartSnapshot>;
  updateCart: (patch: DinkusCartUpdatePatch) => Promise<DinkusCartUpdateResult>;
  openCart: () => void;
  getCheckoutPreview: () => Promise<DinkusCheckoutPreview>;
  proceedToCheckout: (input?: Readonly<{
    buyerConfirmed?: boolean;
    reviewFingerprint?: string;
  }>) => Promise<DinkusCheckoutProceedResult>;
}>;

export type StorefrontWebMcpEnvironment = Readonly<{
  storage?: GuestCartStoragePort | null;
  fetchSnapshot?: (ids: readonly string[]) => Promise<readonly GuestCartCatalogSnapshot[] | null>;
  navigate?: (path: string) => void;
  dispatchEvent?: (eventName: string, detail: unknown) => void;
  modelContext?: ModelContextHost | null;
  globalTarget?: Record<string, unknown> | null;
}>;

export function computeCartReviewFingerprint(
  intent: GuestCartIntent,
  resolved?: Readonly<{
    currency?: string;
    subtotalMinor?: number | null;
    lines?: readonly DinkusCartLineSnapshot[];
  }>,
): string {
  if (intent.lines.length === 0) return "cart:empty";
  const resolvedById = new Map<string, DinkusCartLineSnapshot>();
  if (resolved?.lines) {
    for (const line of resolved.lines) {
      resolvedById.set(line.id, line);
    }
  }
  const canonicalLines = [...intent.lines]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((line) => {
      const snap = resolvedById.get(line.id);
      if (!snap) {
        return `${line.id}:${line.quantity}:unquoted`;
      }
      return [
        line.id,
        String(line.quantity),
        snap.unitPriceMinor !== null ? String(snap.unitPriceMinor) : "unpriced",
        snap.lineSubtotalMinor !== null ? String(snap.lineSubtotalMinor) : "unpriced",
        snap.sellable !== null ? String(snap.sellable) : "unknown",
        snap.fulfillment ?? "unknown",
        snap.currency,
      ].join(":");
    })
    .join("|");
  const subtotalToken =
    resolved && resolved.subtotalMinor !== undefined && resolved.subtotalMinor !== null
      ? String(resolved.subtotalMinor)
      : "unpriced";
  const currencyToken = resolved?.currency ?? "USD";
  const canonical = `${canonicalLines}|currency=${currencyToken}|subtotal=${subtotalToken}`;
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cart:${(hash >>> 0).toString(16).padStart(8, "0")}:${intent.lines.length}`;
}

async function defaultFetchCatalogSnapshots(
  ids: readonly string[],
): Promise<readonly GuestCartCatalogSnapshot[] | null> {
  if (ids.length === 0 || typeof fetch !== "function") return [];
  try {
    const response = await fetch(
      `/api/guest-cart/snapshot?ids=${encodeURIComponent(ids.join(","))}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    return parseGuestCartSnapshotResponse(await response.json());
  } catch {
    return null;
  }
}

function defaultEmitEvent(eventName: string, detail: unknown): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
  if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
    if (eventName === "dinkus:cart:updated") {
      document.dispatchEvent(new CustomEvent("guest-cart-updated"));
      document.dispatchEvent(new CustomEvent("dinkus:guest-cart-hydrate"));
    }
  }
}

function defaultNavigate(path: string): void {
  if (typeof window !== "undefined" && window.location && typeof window.location.assign === "function") {
    window.location.assign(path);
  }
}

function parseMinorUnit(minorText: string | null | undefined): number | null {
  if (typeof minorText !== "string" || !/^\d+$/u.test(minorText)) return null;
  const parsed = Number(minorText);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function buildCartSnapshot(
  intent: GuestCartIntent,
  notice: GuestCartReadNotice | null,
  catalogSnapshots: readonly GuestCartCatalogSnapshot[] | null,
): DinkusCartSnapshot {
  const byId = new Map<string, GuestCartCatalogSnapshot>();
  if (catalogSnapshots) {
    for (const entry of catalogSnapshots) {
      byId.set(entry.id, entry);
    }
  }
  let subtotalMinor: number | null = intent.lines.length === 0 ? 0 : 0;
  const lines: DinkusCartLineSnapshot[] = intent.lines.map((line: GuestCartLine) => {
    const snap = byId.get(line.id);
    if (!snap || !snap.found) {
      subtotalMinor = null;
      return {
        id: line.id,
        quantity: line.quantity,
        name: null,
        sku: null,
        fulfillment: null,
        sellable: snap ? false : null,
        unitPriceMinor: null,
        lineSubtotalMinor: null,
        currency: "USD",
      };
    }
    const unitMinor = parseMinorUnit(snap.price.unitMinor);
    const lineMinor =
      unitMinor !== null && Number.isSafeInteger(unitMinor * line.quantity)
        ? unitMinor * line.quantity
        : null;
    if (lineMinor === null || subtotalMinor === null) {
      subtotalMinor = null;
    } else {
      subtotalMinor += lineMinor;
    }
    return {
      id: line.id,
      quantity: line.quantity,
      name: snap.name,
      sku: snap.sku,
      fulfillment: snap.fulfillment ?? null,
      sellable: snap.availability.sellable && snap.price.listable,
      unitPriceMinor: unitMinor,
      lineSubtotalMinor: lineMinor,
      currency: "USD",
    };
  });

  return Object.freeze({
    ok: true,
    untrustedContent: true,
    currency: "USD",
    itemCount: guestCartItemCount(intent),
    subtotalMinor,
    reviewFingerprint: computeCartReviewFingerprint(intent, {
      currency: "USD",
      subtotalMinor,
      lines,
    }),
    lines: Object.freeze(lines),
    storageNotice: notice,
  });
}

export function createStorefrontActions(
  env: StorefrontWebMcpEnvironment = {},
): DinkusStorefrontActions {
  const resolveStorage = (): GuestCartStoragePort | null =>
    env.storage !== undefined ? env.storage : readBrowserGuestCartStorage();
  const fetchSnapshot = env.fetchSnapshot ?? defaultFetchCatalogSnapshots;
  const emit = env.dispatchEvent ?? defaultEmitEvent;
  const navigate = env.navigate ?? defaultNavigate;

  let pendingReviewFingerprint: string | null = null;
  let confirmedReviewFingerprint: string | null = null;

  const getCart = async (
    options?: Readonly<{ includeCatalog?: boolean }>,
  ): Promise<DinkusCartSnapshot> => {
    const loaded = loadGuestCartIntent(GUEST_CART_STORAGE_KEY, resolveStorage());
    const includeCatalog = options?.includeCatalog !== false;
    const snapshots =
      includeCatalog && loaded.intent.lines.length > 0
        ? await fetchSnapshot(loaded.intent.lines.map((line) => line.id))
        : null;
    return buildCartSnapshot(loaded.intent, loaded.notice, snapshots);
  };

  const updateCart = async (
    patch: DinkusCartUpdatePatch,
  ): Promise<DinkusCartUpdateResult> => {
    if (!patch || typeof patch !== "object") {
      const error: DinkusCartUpdateResult = {
        ok: false,
        code: "INVALID_PATCH",
        message: "Cart update requires a structured patch object.",
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
      emit("dinkus:cart:error", error);
      return error;
    }

    if (patch.mode === "replace" && patch.clear !== true && !Array.isArray(patch.lines)) {
      const error: DinkusCartUpdateResult = {
        ok: false,
        code: "INVALID_PATCH",
        message: "Cart lines must be an array of { id, quantity } entries.",
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
      emit("dinkus:cart:error", error);
      return error;
    }

    const store = resolveStorage();
    const loaded = loadGuestCartIntent(GUEST_CART_STORAGE_KEY, store);
    let current: GuestCartIntent =
      patch.clear === true || patch.mode === "replace"
        ? emptyGuestCartIntent()
        : loaded.intent;

    if (patch.lines !== undefined) {
      if (!Array.isArray(patch.lines)) {
        const error: DinkusCartUpdateResult = {
          ok: false,
          code: "INVALID_PATCH",
          message: "Cart lines must be an array of { id, quantity } entries.",
          instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
        };
        emit("dinkus:cart:error", error);
        return error;
      }

      for (const item of patch.lines) {
        if (!item || typeof item !== "object" || !isSafeGuestCartProductId(item.id)) {
          const error: DinkusCartUpdateResult = {
            ok: false,
            code: "INVALID_PRODUCT_ID",
            message: "Each cart line requires a valid Commerce product identifier.",
            instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
          };
          emit("dinkus:cart:error", error);
          return error;
        }
        const id = item.id.trim();
        if (item.quantity === 0) {
          if (patch.mode === "replace" || patch.mode === "add") {
            const error: DinkusCartUpdateResult = {
              ok: false,
              code: "INVALID_QUANTITY",
              message:
                patch.mode === "add"
                  ? `Additive add_to_cart requires a positive quantity from 1 to ${GUEST_CART_MAX_QUANTITY}.`
                  : "Full-replacement update_cart_lines requires positive quantities (1..99); omit a line from the array to remove it.",
              instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
            };
            emit("dinkus:cart:error", error);
            return error;
          }
          const removed = removeGuestCartLine(current, id);
          if (removed.accepted) current = removed.intent;
          continue;
        }
        if (!isSafeGuestCartQuantity(item.quantity)) {
          const error: DinkusCartUpdateResult = {
            ok: false,
            code: "INVALID_QUANTITY",
            message: `Quantity must be a whole number from 1 to ${GUEST_CART_MAX_QUANTITY}.`,
            instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
          };
          emit("dinkus:cart:error", error);
          return error;
        }
        const exists = current.lines.some((line) => line.id === id);
        const mutation =
          patch.mode === "replace" && exists
            ? setGuestCartLineQuantity(current, id, item.quantity)
            : addGuestCartLine(current, id, item.quantity);
        if (!mutation.accepted) {
          const error: DinkusCartUpdateResult = {
            ok: false,
            code: "CART_LINE_LIMIT",
            message: mutation.reason ?? "The cart line limit was reached.",
            instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
          };
          emit("dinkus:cart:error", error);
          return error;
        }
        current = mutation.intent;
      }
    }

    const saved = saveGuestCartIntent(GUEST_CART_STORAGE_KEY, current, store);
    if (!saved.persisted) {
      const error: DinkusCartUpdateResult = {
        ok: false,
        code: "STORAGE_UNAVAILABLE",
        message: "Browser cart storage is unavailable.",
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
      emit("dinkus:cart:error", error);
      return error;
    }

    pendingReviewFingerprint = null;
    confirmedReviewFingerprint = null;
    const snapshots =
      saved.intent.lines.length > 0
        ? await fetchSnapshot(saved.intent.lines.map((line) => line.id))
        : null;
    const cart = buildCartSnapshot(saved.intent, saved.notice, snapshots);
    emit("dinkus:cart:updated", cart);
    return {
      ok: true,
      untrustedContent: true,
      cart,
    };
  };

  const openCart = (): void => {
    navigate("/cart");
  };

  const getCheckoutPreview = async (): Promise<DinkusCheckoutPreview> => {
    const cart = await getCart({ includeCatalog: true });
    const reviewStatus =
      cart.itemCount === 0
        ? "empty_cart"
        : confirmedReviewFingerprint === cart.reviewFingerprint
          ? "buyer_reviewed"
          : "buyer_review_required";
    return Object.freeze({
      ok: true,
      untrustedContent: true,
      currency: cart.currency,
      itemCount: cart.itemCount,
      reviewFingerprint: cart.reviewFingerprint,
      reviewStatus,
      totals: Object.freeze({
        subtotalMinor: cart.subtotalMinor,
        shippingMinor: null,
        discountMinor: 0,
        taxMinor: null,
        totalMinor: null,
      }),
      lines: cart.lines,
      continueUrl: "/checkout",
    });
  };

  const proceedToCheckout = async (
    input?: Readonly<{
      buyerConfirmed?: boolean;
      reviewFingerprint?: string;
    }>,
  ): Promise<DinkusCheckoutProceedResult> => {
    const preview = await getCheckoutPreview();
    if (preview.itemCount === 0) {
      return {
        ok: false,
        code: "EMPTY_CART",
        message: "Add sellable products to the cart before proceeding to checkout.",
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
    }
    const unsellable = preview.lines.find((line) => line.sellable === false);
    if (unsellable) {
      return {
        ok: false,
        code: "UNSELLABLE_LINE",
        message: `Product ${unsellable.id} is not currently sellable. Remove it before proceeding to checkout.`,
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
    }
    if (preview.totals.subtotalMinor === null) {
      return {
        ok: false,
        code: "PRICE_UNAVAILABLE",
        message: "Authoritative Commerce prices could not be verified for every cart line.",
        instruction: WEBMCP_ANTI_SCRAPE_NOTICE,
      };
    }

    const suppliedFingerprint =
      typeof input?.reviewFingerprint === "string" ? input.reviewFingerprint.trim() : "";
    const hasPendingOrConfirmedReview =
      pendingReviewFingerprint === preview.reviewFingerprint ||
      confirmedReviewFingerprint === preview.reviewFingerprint;
    const confirmed =
      input?.buyerConfirmed === true &&
      suppliedFingerprint.length > 0 &&
      hasPendingOrConfirmedReview &&
      suppliedFingerprint === preview.reviewFingerprint;

    if (!confirmed) {
      pendingReviewFingerprint = preview.reviewFingerprint;
      confirmedReviewFingerprint = null;
      return {
        ok: true,
        status: "buyer_review_required",
        untrustedContent: true,
        reviewFingerprint: preview.reviewFingerprint,
        continueUrl: "/checkout",
        totals: preview.totals,
        instruction:
          "Present the cart lines and integer minor-unit merchandise subtotal to the shopper for explicit confirmation before calling proceed_to_checkout with buyerConfirmed: true and the exact matching reviewFingerprint. " +
          WEBMCP_ANTI_SCRAPE_NOTICE,
      };
    }

    confirmedReviewFingerprint = preview.reviewFingerprint;
    navigate("/checkout");
    return {
      ok: true,
      status: "requires_escalation",
      untrustedContent: true,
      reviewFingerprint: preview.reviewFingerprint,
      continueUrl: "/checkout",
      totals: preview.totals,
      instruction:
        "Shopper review confirmed. Payment completion is escalated to the store's own checkout page (/checkout); agents never submit raw payment credentials.",
    };
  };

  return Object.freeze({
    getCart,
    updateCart,
    openCart,
    getCheckoutPreview,
    proceedToCheckout,
  });
}

export function buildStorefrontWebMcpTools(
  actions: DinkusStorefrontActions,
): readonly WebMcpToolDescriptor[] {
  return Object.freeze([
    {
      name: "get_cart",
      description:
        "Read the current storefront cart lines, quantities, and authoritative Commerce integer minor-unit prices (for two-decimal USD, 2499 equals $24.99).",
      annotations: Object.freeze({
        title: "Get Cart",
        readOnlyHint: true,
        consequentialHint: false,
        untrustedContentHint: true,
        idempotentHint: true,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: {},
      }),
      execute: async () => actions.getCart({ includeCatalog: true }),
    },
    {
      name: "add_to_cart",
      description:
        "Add or increment a sellable Commerce product in the storefront guest cart by product id and integer quantity (1..99).",
      annotations: Object.freeze({
        title: "Add to Cart",
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: true,
        idempotentHint: false,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", description: "Commerce catalog product id." },
          quantity: {
            type: "integer",
            minimum: 1,
            maximum: GUEST_CART_MAX_QUANTITY,
            default: 1,
          },
        },
      }),
      execute: async (args) => {
        const id = typeof args?.id === "string" ? args.id : "";
        const quantity = typeof args?.quantity === "number" ? args.quantity : 1;
        return actions.updateCart({
          mode: "add",
          lines: [{ id, quantity }],
        });
      },
    },
    {
      name: "update_cart_lines",
      description:
        "Replace the complete desired cart line list (full PUT semantics: omit a line to remove it; quantities must be 1..99).",
      annotations: Object.freeze({
        title: "Update Cart Lines",
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: true,
        idempotentHint: true,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["lines"],
        properties: {
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "quantity"],
              properties: {
                id: { type: "string" },
                quantity: {
                  type: "integer",
                  minimum: 1,
                  maximum: GUEST_CART_MAX_QUANTITY,
                },
              },
            },
          },
        },
      }),
      execute: async (args) =>
        actions.updateCart({
          mode: "replace",
          lines: args?.lines as unknown as readonly Readonly<{
            id: string;
            quantity: number;
          }>[],
        }),
    },
    {
      name: "cancel_cart",
      description: "Clear all lines from the current storefront guest cart.",
      annotations: Object.freeze({
        title: "Cancel Cart",
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: true,
        idempotentHint: true,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: {},
      }),
      execute: async () => actions.updateCart({ clear: true }),
    },
    {
      name: "get_checkout_preview",
      description:
        "Read deterministic integer minor-unit merchandise subtotal (subtotalMinor, discountMinor) and reviewFingerprint before buyer confirmation. Shipping, tax, and final order total (shippingMinor, taxMinor, totalMinor) remain null until authoritative charges are resolved on /checkout.",
      annotations: Object.freeze({
        title: "Get Checkout Preview",
        readOnlyHint: true,
        consequentialHint: false,
        untrustedContentHint: true,
        idempotentHint: true,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: {},
      }),
      execute: async () => actions.getCheckoutPreview(),
    },
    {
      name: "proceed_to_checkout",
      description:
        "Two-step buyer review gate for checkout handoff. First call transitions to buyer_review_required and returns reviewFingerprint; second call requires both buyerConfirmed: true and the exact matching reviewFingerprint before escalating to /checkout.",
      annotations: Object.freeze({
        title: "Proceed to Checkout",
        readOnlyHint: false,
        consequentialHint: true,
        untrustedContentHint: true,
        idempotentHint: false,
      }),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: {
          buyerConfirmed: {
            type: "boolean",
            description:
              "Set true only after the human shopper has explicitly reviewed and approved the current reviewFingerprint and subtotal.",
          },
          reviewFingerprint: {
            type: "string",
            description:
              "Exact cart quote fingerprint returned by the prior buyer_review_required step (required when buyerConfirmed is true).",
          },
        },
      }),
      execute: async (args) =>
        actions.proceedToCheckout({
          buyerConfirmed: args?.buyerConfirmed === true,
          reviewFingerprint:
            typeof args?.reviewFingerprint === "string"
              ? args.reviewFingerprint
              : undefined,
        }),
    },
  ]);
}

function resolveBrowserModelContext(
  env: StorefrontWebMcpEnvironment,
): ModelContextHost | null {
  if (env.modelContext !== undefined) return env.modelContext;
  if (typeof document !== "undefined") {
    const docContext = (document as unknown as { modelContext?: ModelContextHost }).modelContext;
    if (docContext && typeof docContext.registerTool === "function") return docContext;
  }
  if (typeof navigator !== "undefined") {
    const navContext = (navigator as unknown as { modelContext?: ModelContextHost }).modelContext;
    if (navContext && typeof navContext.registerTool === "function") return navContext;
  }
  return null;
}

export function installStorefrontWebMcp(
  env: StorefrontWebMcpEnvironment = {},
): Readonly<{
  actions: DinkusStorefrontActions;
  webMcpRegistered: boolean;
  toolNames: readonly string[];
}> {
  const target =
    env.globalTarget !== undefined
      ? env.globalTarget
      : typeof window !== "undefined"
        ? (window as unknown as Record<string, unknown>)
        : null;

  const existingNamespace =
    target && typeof target.Dinkus === "object" && target.Dinkus !== null
      ? (target.Dinkus as Record<string, unknown>)
      : null;

  const existingActions =
    existingNamespace &&
    typeof existingNamespace.actions === "object" &&
    existingNamespace.actions !== null
      ? (existingNamespace.actions as DinkusStorefrontActions)
      : null;

  const actions = existingActions ?? createStorefrontActions(env);

  if (target && !existingActions) {
    target.Dinkus = Object.freeze({
      ...(existingNamespace ?? {}),
      actions,
    });
  }

  const host = resolveBrowserModelContext(env);
  if (!host || typeof host.registerTool !== "function") {
    return Object.freeze({
      actions,
      webMcpRegistered: false,
      toolNames: Object.freeze([]),
    });
  }

  const tools = buildStorefrontWebMcpTools(actions);
  if (host[WEBMCP_REGISTRATION_SYMBOL] !== true) {
    for (const tool of tools) {
      host.registerTool(tool);
    }
    host[WEBMCP_REGISTRATION_SYMBOL] = true;
  }

  return Object.freeze({
    actions,
    webMcpRegistered: true,
    toolNames: Object.freeze(tools.map((tool) => tool.name)),
  });
}
