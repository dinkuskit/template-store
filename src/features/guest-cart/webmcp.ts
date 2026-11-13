import { GUEST_CART_MAX_LINES, GUEST_CART_MAX_QUANTITY } from "./intent.js";
import { parseGuestCartSnapshotResponse, type GuestCartCatalogSnapshot } from "./present.js";

/**
 * Browser agent tools on the shopper's server cart (template-cart-agents-20261113). Every tool calls the store's
 * own cart endpoints (/cart.js, /cart/update.js), so an agent sees and changes the very cart the shopper sees.
 * The names follow Shopify's agent tools: get_cart, create_cart, update_cart, cancel_cart, show_variant and
 * proceed_to_checkout. A write quotes the cart version it read; a stale version changes nothing.
 */
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
  [WEBMCP_REGISTRATION_SYMBOL]?: boolean;
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
  /** Quote this on update_cart and cancel_cart; null for a cart that holds nothing yet. */
  version: string | null;
  currency: string;
  itemCount: number;
  subtotalMinor: number | null;
  reviewFingerprint: string;
  lines: readonly DinkusCartLineSnapshot[];
  /** A payment the shopper opened: the cart is held until it finishes or expires. */
  checkoutOpen: boolean;
}>;

export type DinkusCartLineInput = Readonly<
  | { id: string; quantity: number }
  | { productId: string; options: Readonly<Record<string, string>>; quantity: number }
>;

export type DinkusCartError = Readonly<{
  ok: false;
  code: string;
  message: string;
  instruction: string;
  /** The cart as it stands now, when the store could read it. */
  cart?: DinkusCartSnapshot;
}>;

export type DinkusCartWriteResult = Readonly<{ ok: true; untrustedContent: true; cart: DinkusCartSnapshot }> | DinkusCartError;

export type DinkusCheckoutProceedResult =
  | Readonly<{
      ok: true;
      status: "buyer_review_required" | "requires_escalation";
      untrustedContent: true;
      reviewFingerprint: string;
      continueUrl: "/checkout";
      subtotalMinor: number;
      instruction: string;
    }>
  | DinkusCartError;

export type DinkusStorefrontActions = Readonly<{
  getCart: () => Promise<DinkusCartSnapshot | DinkusCartError>;
  createCart: (lines: readonly DinkusCartLineInput[]) => Promise<DinkusCartWriteResult>;
  updateCart: (input: Readonly<{ version: string | null; lines: readonly DinkusCartLineInput[]; key?: string }>) => Promise<DinkusCartWriteResult>;
  cancelCart: (input: Readonly<{ version: string | null }>) => Promise<DinkusCartWriteResult>;
  showVariant: (input: Readonly<{ productId: string; variantId?: string }>) => Promise<Readonly<{ ok: true; url: string }> | DinkusCartError>;
  openCart: () => void;
  proceedToCheckout: (input?: Readonly<{ buyerConfirmed?: boolean; reviewFingerprint?: string }>) => Promise<DinkusCheckoutProceedResult>;
}>;

type CartWire = Readonly<{
  ok?: boolean;
  cart?: { lines?: { catalogItemId: string; quantity: number }[]; version?: string | null; itemCount?: number };
  checkout?: { open?: boolean };
  error?: { code?: string; message?: string };
}>;

export type StorefrontWebMcpEnvironment = Readonly<{
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  fetchSnapshot?: (ids: readonly string[]) => Promise<readonly GuestCartCatalogSnapshot[] | null>;
  navigate?: (path: string) => void;
  /** Called with the new item count after every write, so the page's cart badge follows. */
  onCartChanged?: (count: number) => void;
  modelContext?: ModelContextHost | null;
  globalTarget?: Record<string, unknown> | null;
}>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function fail(code: string, message: string, cart?: DinkusCartSnapshot): DinkusCartError {
  return { ok: false, code, message, instruction: WEBMCP_ANTI_SCRAPE_NOTICE, ...(cart ? { cart } : {}) };
}

function fingerprint(version: string | null, lines: readonly DinkusCartLineSnapshot[], subtotal: number | null): string {
  if (!lines.length) return "cart:empty";
  const canonical = `${version}|${lines.map((line) => `${line.id}:${line.quantity}:${line.unitPriceMinor ?? "unpriced"}:${line.sellable}`).join("|")}|${subtotal ?? "unpriced"}`;
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cart:${(hash >>> 0).toString(16).padStart(8, "0")}:${lines.length}`;
}

function minor(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function snapshotOf(wire: CartWire, catalog: readonly GuestCartCatalogSnapshot[] | null): DinkusCartSnapshot {
  const byId = new Map((catalog ?? []).map((entry) => [entry.id, entry]));
  const version = wire.cart?.version ?? null;
  let subtotal: number | null = 0;
  const lines = (wire.cart?.lines ?? []).map((line): DinkusCartLineSnapshot => {
    const snap = byId.get(line.catalogItemId);
    const unit = snap?.found ? minor(snap.price.unitMinor) : null;
    const lineMinor = unit !== null && Number.isSafeInteger(unit * line.quantity) ? unit * line.quantity : null;
    subtotal = lineMinor === null || subtotal === null ? null : subtotal + lineMinor;
    return {
      id: line.catalogItemId,
      quantity: line.quantity,
      name: snap?.found ? snap.name : null,
      sku: snap?.found ? snap.sku : null,
      fulfillment: snap?.found ? snap.fulfillment ?? null : null,
      sellable: snap ? snap.found && snap.availability.sellable && snap.price.listable : null,
      unitPriceMinor: unit,
      lineSubtotalMinor: lineMinor,
      currency: "USD",
    };
  });
  return Object.freeze({
    ok: true,
    untrustedContent: true,
    version,
    currency: "USD",
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: subtotal,
    reviewFingerprint: fingerprint(version, lines, subtotal),
    lines: Object.freeze(lines),
    checkoutOpen: wire.checkout?.open === true,
  });
}

async function defaultFetchSnapshot(ids: readonly string[]): Promise<readonly GuestCartCatalogSnapshot[] | null> {
  if (!ids.length) return [];
  try {
    const response = await fetch(`/api/guest-cart/snapshot?ids=${encodeURIComponent(ids.join(","))}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? parseGuestCartSnapshotResponse(await response.json()) : null;
  } catch {
    return null;
  }
}

function lineInputs(value: unknown): { catalogItemId?: string; productId?: string; options?: Record<string, string>; quantity: number }[] | string {
  if (!Array.isArray(value)) return "Cart lines must be an array of { id, quantity } or { productId, options, quantity } entries.";
  if (value.length > GUEST_CART_MAX_LINES) return `A cart holds up to ${GUEST_CART_MAX_LINES} lines.`;
  const lines = [];
  for (const raw of value) {
    const line = (raw ?? {}) as { id?: unknown; productId?: unknown; options?: unknown; quantity?: unknown };
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > GUEST_CART_MAX_QUANTITY) {
      return `Quantity must be a whole number from 1 to ${GUEST_CART_MAX_QUANTITY}; omit a line to remove it.`;
    }
    if (typeof line.id === "string" && SAFE_ID.test(line.id.trim())) {
      lines.push({ catalogItemId: line.id.trim(), quantity });
    } else if (typeof line.productId === "string" && SAFE_ID.test(line.productId.trim()) && line.options &&
        typeof line.options === "object" && !Array.isArray(line.options) &&
        Object.values(line.options).every((choice) => typeof choice === "string")) {
      lines.push({ productId: line.productId.trim(), options: line.options as Record<string, string>, quantity });
    } else {
      return "Each cart line needs a Commerce item id, or a productId with its options (for example { Size: \"M\" }).";
    }
  }
  return lines;
}

export function createStorefrontActions(env: StorefrontWebMcpEnvironment = {}): DinkusStorefrontActions {
  const send = env.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const fetchSnapshot = env.fetchSnapshot ?? defaultFetchSnapshot;
  const navigate = env.navigate ?? ((path: string) => window.location.assign(path));
  const changed = env.onCartChanged ?? (() => {});
  // proceed_to_checkout's first call records the fingerprint the shopper must review.
  let pendingReview: string | null = null;

  const call = async (path: string, init?: RequestInit): Promise<CartWire | null> => {
    try {
      const response = await send(path, {
        ...init,
        headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => null) as CartWire | null;
      return body && typeof body === "object" ? body : null;
    } catch {
      return null;
    }
  };

  const withCatalog = async (wire: CartWire): Promise<DinkusCartSnapshot> =>
    snapshotOf(wire, await fetchSnapshot((wire.cart?.lines ?? []).map((line) => line.catalogItemId)));

  const getCart = async (): Promise<DinkusCartSnapshot | DinkusCartError> => {
    const wire = await call("/cart.js");
    if (!wire) return fail("UNAVAILABLE", "The cart is unavailable right now. Try again in a moment.");
    if (wire.ok === false && wire.error?.code !== "NO_CART") {
      return fail(wire.error?.code ?? "UNAVAILABLE", wire.error?.message ?? "The cart could not be read.");
    }
    return withCatalog(wire);
  };

  const write = async (body: Readonly<Record<string, unknown>>): Promise<DinkusCartWriteResult> => {
    const wire = await call("/cart/update.js", { method: "POST", body: JSON.stringify(body) });
    if (!wire) return fail("UNAVAILABLE", "The cart is unavailable right now. Try again in a moment.");
    pendingReview = null;
    const cart = await withCatalog(wire);
    if (wire.ok !== true) {
      const code = wire.error?.code ?? "UNAVAILABLE";
      const message = code === "CONTENTION"
        ? "The cart changed since you read it. Read it again with get_cart and quote its version."
        : wire.error?.message ?? "That cart change could not be made.";
      return fail(code, message, wire.cart ? cart : undefined);
    }
    changed(cart.itemCount);
    return { ok: true, untrustedContent: true, cart };
  };

  const updateCart: DinkusStorefrontActions["updateCart"] = async (input) => {
    const lines = lineInputs(input?.lines);
    if (typeof lines === "string") return fail("INVALID_INPUT", lines);
    if (input.version !== null && typeof input.version !== "string") {
      return fail("INVALID_INPUT", "Quote the cart version from get_cart (null for a cart that holds nothing yet).");
    }
    return write({ version: input.version, lines, ...(input.key ? { key: input.key } : {}) });
  };

  const createCart: DinkusStorefrontActions["createCart"] = async (lines) => {
    const current = await getCart();
    if (!current.ok) return current;
    if (current.lines.length) {
      return fail("CART_EXISTS", "This shopper already has a cart. Use update_cart with its version, or cancel_cart first.", current);
    }
    return updateCart({ version: current.version, lines });
  };

  const cancelCart: DinkusStorefrontActions["cancelCart"] = async (input) =>
    input?.version !== null && typeof input?.version !== "string"
      ? fail("INVALID_INPUT", "Quote the cart version from get_cart.")
      : write({ version: input.version, lines: [] });

  const showVariant: DinkusStorefrontActions["showVariant"] = async (input) => {
    const productId = typeof input?.productId === "string" ? input.productId.trim() : "";
    const variantId = typeof input?.variantId === "string" ? input.variantId.trim() : "";
    if (!SAFE_ID.test(productId) || (variantId && !SAFE_ID.test(variantId))) {
      return fail("INVALID_INPUT", "show_variant needs the product's id and, optionally, a variant id.");
    }
    // Product pages live at their published slug, not the Commerce id: the store's /variants/<id> finds the page.
    type VariantLink = { ok?: boolean; url?: unknown; error?: { code?: string; message?: string } };
    const found = await send(`/variants/${encodeURIComponent(variantId || productId)}`, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    }).then((response) => response.json() as Promise<VariantLink>).catch((): VariantLink | null => null);
    const url = found?.ok && typeof found.url === "string" && found.url.startsWith("/products/") ? found.url : null;
    if (!url) {
      return fail(found?.error?.code ?? "UNAVAILABLE", found?.error?.message ?? "The product page could not be found right now.");
    }
    navigate(url);
    return { ok: true, url };
  };

  const proceedToCheckout: DinkusStorefrontActions["proceedToCheckout"] = async (input) => {
    const cart = await getCart();
    if (!cart.ok) return cart;
    if (!cart.lines.length) return fail("EMPTY_CART", "Add products to the cart before proceeding to checkout.", cart);
    const unsellable = cart.lines.find((line) => line.sellable === false);
    if (unsellable) return fail("UNSELLABLE_LINE", `Product ${unsellable.id} is not for sale right now. Remove it first.`, cart);
    if (cart.subtotalMinor === null) return fail("PRICE_UNAVAILABLE", "Commerce prices could not be read for every cart line.", cart);
    const supplied = typeof input?.reviewFingerprint === "string" ? input.reviewFingerprint.trim() : "";
    if (input?.buyerConfirmed === true && pendingReview === cart.reviewFingerprint && supplied === cart.reviewFingerprint) {
      pendingReview = null;
      navigate("/checkout");
      return {
        ok: true,
        status: "requires_escalation",
        untrustedContent: true,
        reviewFingerprint: cart.reviewFingerprint,
        continueUrl: "/checkout",
        subtotalMinor: cart.subtotalMinor,
        instruction: "Shopper review confirmed. The shopper enters their details and pays on the store's own checkout page (/checkout); agents never submit payment credentials.",
      };
    }
    pendingReview = cart.reviewFingerprint;
    return {
      ok: true,
      status: "buyer_review_required",
      untrustedContent: true,
      reviewFingerprint: cart.reviewFingerprint,
      continueUrl: "/checkout",
      subtotalMinor: cart.subtotalMinor,
      instruction: "Show the shopper the cart lines and the subtotal (integer minor units) and get their explicit approval, then call proceed_to_checkout again with buyerConfirmed: true and this exact reviewFingerprint. " +
        WEBMCP_ANTI_SCRAPE_NOTICE,
    };
  };

  return Object.freeze({
    getCart,
    createCart,
    updateCart,
    cancelCart,
    showVariant,
    openCart: () => navigate("/cart"),
    proceedToCheckout,
  });
}

const LINE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["quantity"],
  properties: {
    id: { type: "string", description: "Commerce item id (a product without options, or one exact variant)." },
    productId: { type: "string", description: "Commerce product id, with options instead of an item id." },
    options: { type: "object", additionalProperties: { type: "string" }, description: "Chosen options, for example { \"Size\": \"M\" }." },
    quantity: { type: "integer", minimum: 1, maximum: GUEST_CART_MAX_QUANTITY },
  },
});

const LINES_SCHEMA = Object.freeze({ type: "array", maxItems: GUEST_CART_MAX_LINES, items: LINE_SCHEMA });
const VERSION_SCHEMA = Object.freeze({ type: ["string", "null"], description: "The cart version get_cart returned." });

function annotations(title: string, readOnly: boolean, idempotent: boolean, consequential = false): WebMcpToolAnnotations {
  return Object.freeze({ title, readOnlyHint: readOnly, consequentialHint: consequential, untrustedContentHint: true, idempotentHint: idempotent });
}

export function buildStorefrontWebMcpTools(actions: DinkusStorefrontActions): readonly WebMcpToolDescriptor[] {
  const tools: WebMcpToolDescriptor[] = [
    {
      name: "get_cart",
      description: "Read the shopper's cart: its version, lines, quantities and Commerce prices in integer minor units (2499 is $24.99).",
      annotations: annotations("Get cart", true, true),
      inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: {} }),
      execute: async () => actions.getCart(),
    },
    {
      name: "create_cart",
      description: "Fill an empty cart with these lines. If the shopper already has items, use update_cart instead.",
      annotations: annotations("Create cart", false, false),
      inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["lines"], properties: { lines: LINES_SCHEMA } }),
      execute: async (args) => actions.createCart((args?.lines ?? []) as readonly DinkusCartLineInput[]),
    },
    {
      name: "update_cart",
      description: "Replace the whole cart with these lines (omit a line to remove it), quoting the version get_cart returned. A stale version changes nothing and answers CONTENTION with the current cart. Pass the same key to retry safely.",
      annotations: annotations("Update cart", false, true),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["version", "lines"],
        properties: {
          version: VERSION_SCHEMA,
          lines: LINES_SCHEMA,
          key: { type: "string", maxLength: 128, description: "Optional retry key: the same key with the same change is applied once." },
        },
      }),
      execute: async (args) => actions.updateCart({
        version: (args?.version ?? null) as string | null,
        lines: (args?.lines ?? []) as readonly DinkusCartLineInput[],
        ...(typeof args?.key === "string" ? { key: args.key } : {}),
      }),
    },
    {
      name: "cancel_cart",
      description: "Empty the shopper's cart, quoting the version get_cart returned.",
      annotations: annotations("Cancel cart", false, true),
      inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["version"], properties: { version: VERSION_SCHEMA } }),
      execute: async (args) => actions.cancelCart({ version: (args?.version ?? null) as string | null }),
    },
    {
      name: "show_variant",
      description: "Open a product page for the shopper, on one variant when variantId is given.",
      annotations: annotations("Show variant", false, true),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["productId"],
        properties: { productId: { type: "string" }, variantId: { type: "string" } },
      }),
      execute: async (args) => actions.showVariant({
        productId: typeof args?.productId === "string" ? args.productId : "",
        ...(typeof args?.variantId === "string" ? { variantId: args.variantId } : {}),
      }),
    },
    {
      name: "proceed_to_checkout",
      description: "Two steps. The first call returns a reviewFingerprint for the shopper to approve; the second, with buyerConfirmed: true and that exact fingerprint, opens /checkout, where the shopper enters their details and pays.",
      annotations: annotations("Proceed to checkout", false, false, true),
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: {
          buyerConfirmed: { type: "boolean", description: "True only after the shopper approved this exact cart and subtotal." },
          reviewFingerprint: { type: "string", description: "The fingerprint the first call returned." },
        },
      }),
      execute: async (args) => actions.proceedToCheckout({
        buyerConfirmed: args?.buyerConfirmed === true,
        ...(typeof args?.reviewFingerprint === "string" ? { reviewFingerprint: args.reviewFingerprint } : {}),
      }),
    },
  ];
  return Object.freeze(tools);
}

function resolveBrowserModelContext(env: StorefrontWebMcpEnvironment): ModelContextHost | null {
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

/** Attach window.Dinkus.actions and, when a WebMCP browser agent is present, register the tools once. */
export function installStorefrontWebMcp(env: StorefrontWebMcpEnvironment = {}): Readonly<{
  actions: DinkusStorefrontActions;
  webMcpRegistered: boolean;
  toolNames: readonly string[];
}> {
  const target = env.globalTarget !== undefined
    ? env.globalTarget
    : typeof window !== "undefined" ? window as unknown as Record<string, unknown> : null;
  const namespace = target && typeof target.Dinkus === "object" && target.Dinkus !== null
    ? target.Dinkus as Record<string, unknown>
    : null;
  const existing = namespace && typeof namespace.actions === "object" && namespace.actions !== null
    ? namespace.actions as DinkusStorefrontActions
    : null;
  const actions = existing ?? createStorefrontActions(env);
  if (target && !existing) target.Dinkus = Object.freeze({ ...(namespace ?? {}), actions });
  const host = resolveBrowserModelContext(env);
  if (!host || typeof host.registerTool !== "function") {
    return Object.freeze({ actions, webMcpRegistered: false, toolNames: Object.freeze([]) });
  }
  const tools = buildStorefrontWebMcpTools(actions);
  if (host[WEBMCP_REGISTRATION_SYMBOL] !== true) {
    for (const tool of tools) host.registerTool(tool);
    host[WEBMCP_REGISTRATION_SYMBOL] = true;
  }
  return Object.freeze({ actions, webMcpRegistered: true, toolNames: Object.freeze(tools.map((tool) => tool.name)) });
}
