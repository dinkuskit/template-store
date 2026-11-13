import type { AstroCookies } from "astro";

import {
  COMMERCE_REGISTRY_RUNTIME_ID,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
  parseGuestCheckoutWireResult,
  type GuestCheckoutContact,
  type GuestCheckoutDelivery,
  type GuestCheckoutProjection,
} from "./checkout-protocol.js";
import { canDispatchInstalledGuestCheckout } from "./checkout-admission.js";
import { GUEST_CART_MAX_LINES, GUEST_CART_MAX_QUANTITY } from "./intent.js";
import { checkoutLimited, playgroundCheckoutConfigured, visitorIp } from "../playground-checkout/index.js";
import { withCheckoutVisitor } from "../playground-checkout/payments-port.js";
import {
  playgroundAttemptBelongsToVisitor,
  playgroundCheckoutBindingsFromLocals,
} from "../playground-checkout/binding-auth.js";

/**
 * The shopper's cart lives in Commerce (commerce-server-cart-20261113). The store site holds the cart's key in
 * an HttpOnly cookie, writes a readable item-count cookie beside it (template-cart-count-cookie-20261113) and
 * calls Commerce's public cart routes inside its own server (template-cart-real-form-20261113).
 */
export const CART_COOKIE = "dk_cart";
export { CART_COUNT_COOKIE_NAME as CART_COUNT_COOKIE } from "./cart-cookie-name.js";
import { CART_COUNT_COOKIE_NAME as CART_COUNT_COOKIE } from "./cart-cookie-name.js";
/** Commerce keeps an untouched cart 30 days (commerce-cart-expiry-20261113); the cookie lasts as long. */
export const CART_COOKIE_SECONDS = 30 * 86_400;
const MAX_RESPONSE_BYTES = 64 * 1024;
const CAPABILITY = /^[A-Za-z0-9._~-]{1,256}\.[A-Za-z0-9._~-]{1,256}$/u;

export type ServerCartLine = Readonly<{ catalogItemId: string; quantity: number }>;
export type ServerCart = Readonly<{
  lines: readonly ServerCartLine[];
  version: string | null;
  expiresAt: number;
  itemCount: number;
}>;
export type ServerCartError = Readonly<{ code: string; message: string }>;
export type ServerCartResult =
  | Readonly<{ ok: true; cart: ServerCart; checkout: GuestCheckoutProjection }>
  | Readonly<{ ok: false; error: ServerCartError; cart?: ServerCart; checkout?: GuestCheckoutProjection }>;

/** A line a shopper or agent asks for: a Commerce item, or a product with its option labels. */
export type ServerCartLineInput =
  | Readonly<{ catalogItemId: string; quantity: number }>
  | Readonly<{ productId: string; options: Readonly<Record<string, string>>; quantity: number }>;

export type ServerCartContext = Readonly<{
  locals: App.Locals;
  request: Request;
  url: URL;
  cookies: AstroCookies;
}>;

type PublicDispatcher = (pluginId: string, method: string, path: string, request: Request) => Promise<unknown>;

/** Plain shop words for each refusal a shopper can meet. */
export const CART_ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  PRODUCT_UNAVAILABLE: "That item is sold out or no longer for sale.",
  CHECKOUT_FROZEN: "Your cart is held while a payment is open. Return to secure checkout to pay, or wait for it to expire.",
  CONTENTION: "Your cart changed in another tab. Check it and try again.",
  INVALID_CART: "That cart change could not be made.",
  INVALID_INPUT: "That cart change could not be made.",
  CART_FULL: `A cart holds up to ${GUEST_CART_MAX_LINES} items and ${GUEST_CART_MAX_QUANTITY} of each.`,
  NO_CART: "Your cart is empty.",
  NOT_PAID: "Your payment was not completed. Your items are still in your cart.",
  RATE_LIMITED: "Too many test checkouts from here. Try again in about 10 minutes.",
  PAYMENTS_UNAVAILABLE: "Checkout is not available yet.",
  INVENTORY_UNAVAILABLE: "An item in your cart just sold out. Check your cart and try again.",
  UNAVAILABLE: "The cart is unavailable right now. Try again in a moment.",
});

export function cartErrorText(code: string): string {
  return CART_ERROR_TEXT[code] ?? CART_ERROR_TEXT.UNAVAILABLE!;
}

function failure(code: string, extra: Partial<Omit<Extract<ServerCartResult, { ok: false }>, "ok" | "error">> = {}): ServerCartResult {
  return { ok: false, error: { code, message: cartErrorText(code) }, ...extra };
}

function envOf(locals: App.Locals): Record<string, unknown> {
  return ((locals as { __playgroundEnv?: Record<string, unknown> }).__playgroundEnv ?? process.env) as Record<string, unknown>;
}

function isPlayground(locals: App.Locals): boolean {
  return Boolean((locals as { __playgroundDb?: unknown }).__playgroundDb);
}

/** The store's configured web address is the authority, never the request's Host. */
export function trustedStoreOrigin(ctx: Pick<ServerCartContext, "locals" | "url">): string {
  const configured = envOf(ctx.locals).EMDASH_SITE_URL;
  try {
    if (typeof configured === "string" && configured) return new URL(configured).origin;
  } catch {
    // Fall through to the request's own origin, which the dev server and tests use.
  }
  return ctx.url.origin;
}

/**
 * A browser write must come from this store: SameSite=Lax already keeps the cart cookie off other sites'
 * posts, and a browser that names the sending site must name this one.
 */
export function sameStoreRequest(ctx: Pick<ServerCartContext, "locals" | "url" | "request">): boolean {
  const site = ctx.request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = ctx.request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      const sent = new URL(origin).origin;
      if (sent !== trustedStoreOrigin(ctx) && sent !== ctx.url.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function readCartKey(cookies: AstroCookies): string | null {
  const value = cookies.get(CART_COOKIE)?.value ?? "";
  return CAPABILITY.test(value) ? value : null;
}

export function itemCount(lines: readonly ServerCartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

function secureCookies(ctx: ServerCartContext): boolean {
  return ctx.url.protocol === "https:";
}

export function writeCartCookies(ctx: ServerCartContext, key: string | null, count: number | null): void {
  const base = { path: "/", sameSite: "lax" as const, secure: secureCookies(ctx), maxAge: CART_COOKIE_SECONDS };
  if (key) ctx.cookies.set(CART_COOKIE, key, { ...base, httpOnly: true });
  if (count !== null) ctx.cookies.set(CART_COUNT_COOKIE, String(count), base);
}

function parseCart(value: unknown): ServerCart | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { lines?: unknown; version?: unknown; expiresAt?: unknown };
  if (!Array.isArray(raw.lines) || (raw.version !== null && typeof raw.version !== "string") ||
      typeof raw.expiresAt !== "number" || !Number.isFinite(raw.expiresAt)) return null;
  const lines: ServerCartLine[] = [];
  for (const line of raw.lines) {
    const { catalogItemId, quantity } = (line ?? {}) as { catalogItemId?: unknown; quantity?: unknown };
    if (typeof catalogItemId !== "string" || !catalogItemId || typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) || quantity < 1) return null;
    lines.push({ catalogItemId, quantity });
  }
  return { lines, version: raw.version, expiresAt: raw.expiresAt, itemCount: itemCount(lines) };
}

function unwrap(body: unknown): unknown {
  return body && typeof body === "object" && (body as { success?: unknown }).success === true
    ? (body as { data?: unknown }).data
    : body;
}

type CommerceAnswer =
  | Readonly<{ ok: true; capability?: string; cart: ServerCart | null; checkout: GuestCheckoutProjection }>
  | Readonly<{ ok: false; code: string; message?: string }>;

/** One in-process call to a Commerce guest route; the answer is size-bounded and validated like the old relay. */
async function callCommerce(
  ctx: ServerCartContext,
  route: "prepare" | "cart" | "start",
  body: unknown,
  key: string | null,
): Promise<CommerceAnswer> {
  const runtime = ctx.locals.emdash as unknown as { handlePublicPluginApiRoute?: PublicDispatcher } | undefined;
  if (!runtime || typeof runtime.handlePublicPluginApiRoute !== "function" ||
      !canDispatchInstalledGuestCheckout({ runtime: runtime as never, request: ctx.request }, { inStore: isPlayground(ctx.locals) })) {
    return { ok: false, code: "UNAVAILABLE" };
  }
  const origin = trustedStoreOrigin(ctx);
  const path = `checkout/guest/${route}`;
  const dispatch = () => runtime.handlePublicPluginApiRoute!(
    COMMERCE_REGISTRY_RUNTIME_ID,
    "POST",
    path,
    new Request(new URL(`/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/${path}`, origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin,
        "sec-fetch-site": "same-origin",
        ...(key ? { [GUEST_CHECKOUT_CAPABILITY_HEADER]: key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  let raw: unknown;
  try {
    raw = await visitorScope(ctx, dispatch);
    const text = JSON.stringify(raw);
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return { ok: false, code: "UNAVAILABLE" };
    }
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
  const parsed = parseGuestCheckoutWireResult(raw);
  if (!parsed) return { ok: false, code: "UNAVAILABLE" };
  if (!parsed.ok) return { ok: false, code: parsed.error.code, message: parsed.error.message };
  const value = unwrap(raw) as { cart?: unknown };
  const cart = value.cart === undefined ? null : parseCart(value.cart);
  if (value.cart !== undefined && !cart) return { ok: false, code: "UNAVAILABLE" };
  if (isPlayground(ctx.locals) && !(await playgroundSeesCheckout(ctx, parsed.checkout))) {
    return { ok: false, code: "UNAVAILABLE" };
  }
  return {
    ok: true,
    ...(parsed.capability ? { capability: parsed.capability.capability } : {}),
    cart,
    checkout: parsed.checkout,
  };
}

/** The playground's Payments calls carry the visitor's IP and session, as its plugin-route guard gives them. */
function visitorScope<T>(ctx: ServerCartContext, run: () => Promise<T>): Promise<T> {
  if (!isPlayground(ctx.locals) || !playgroundCheckoutConfigured(envOf(ctx.locals))) return run();
  return withCheckoutVisitor(visitorIp(ctx.request) ?? "", ctx.cookies.get("emdash_playground")?.value ?? "", run,
    playgroundCheckoutBindingsFromLocals(ctx.locals));
}

/** A finished playground payment is shown only to the visitor session that started it. */
async function playgroundSeesCheckout(ctx: ServerCartContext, checkout: GuestCheckoutProjection): Promise<boolean> {
  const terminal = checkout.state === "paid" || checkout.order !== null;
  if (!terminal) return true;
  return Boolean(checkout.attemptId) && await playgroundAttemptBelongsToVisitor(
    checkout.attemptId!,
    ctx.cookies.get("emdash_playground")?.value ?? "",
    playgroundCheckoutBindingsFromLocals(ctx.locals),
    envOf(ctx.locals),
  );
}

function emptyCart(): ServerCart {
  return { lines: [], version: null, expiresAt: 0, itemCount: 0 };
}

/** Read the shopper's cart. No cookie is an empty cart; reading also runs Commerce's payment check. */
export async function readServerCart(ctx: ServerCartContext): Promise<ServerCartResult & { key?: string | null }> {
  const key = readCartKey(ctx.cookies);
  if (!key) {
    if (ctx.cookies.get(CART_COUNT_COOKIE)?.value) syncCount(ctx, 0);
    return failure("NO_CART", { cart: emptyCart() });
  }
  const answer = await callCommerce(ctx, "cart", {}, key);
  if (!answer.ok) {
    if (answer.code === "CAPABILITY_DENIED") syncCount(ctx, 0);
    return failure(answer.code === "CAPABILITY_DENIED" ? "NO_CART" : answer.code, { cart: emptyCart() });
  }
  const cart = answer.cart ?? emptyCart();
  syncCount(ctx, cart.itemCount);
  return { ok: true, cart, checkout: answer.checkout };
}

/** Keep the readable count right after a change made elsewhere (another tab, an agent, an expired cart). */
function syncCount(ctx: ServerCartContext, count: number): void {
  if (ctx.cookies.get(CART_COUNT_COOKIE)?.value !== String(count)) writeCartCookies(ctx, null, count);
}

async function newCartKey(ctx: ServerCartContext): Promise<string | null> {
  const answer = await callCommerce(ctx, "prepare", {}, null);
  return answer.ok && answer.capability && CAPABILITY.test(answer.capability) ? answer.capability : null;
}

function lineForCommerce(line: ServerCartLineInput) {
  return "catalogItemId" in line
    ? { catalogItemId: line.catalogItemId, quantity: line.quantity }
    : { productId: line.productId, options: line.options, quantity: line.quantity };
}

/**
 * Could the lines outgrow the cart once Commerce works out each size picked by its options and merges it? Lines
 * named by id are checked as they are; only option lines are unknown until Commerce answers.
 */
function mightOverfill(lines: readonly ServerCartLineInput[]): boolean {
  const picked = lines.filter((line) => !("catalogItemId" in line));
  if (!picked.length) return false;
  const most = Math.max(0, ...lines.filter((line) => "catalogItemId" in line).map((line) => line.quantity));
  return lines.length > GUEST_CART_MAX_LINES || most + picked.reduce((sum, line) => sum + line.quantity, 0) > GUEST_CART_MAX_QUANTITY;
}

/**
 * Commerce alone decides which variant a size picks. When the answer could overfill the cart, ask it in a throwaway
 * cart first, so the shopper's cart is written once, with lines already known to fit. Answers the lines by item id,
 * or Commerce's refusal code.
 */
async function resolveLines(ctx: ServerCartContext, lines: readonly ServerCartLineInput[]): Promise<readonly ServerCartLineInput[] | string> {
  const scratch = await newCartKey(ctx);
  if (!scratch) return "UNAVAILABLE";
  const answer = await callCommerce(ctx, "cart", { version: null, lines: lines.map(lineForCommerce) }, scratch);
  if (!answer.ok) return answer.code;
  if (!answer.cart) return "UNAVAILABLE";
  await callCommerce(ctx, "cart", { version: answer.cart.version, lines: [] }, scratch);
  return answer.cart.lines;
}

/**
 * Change the cart: `next` turns the current lines into the wanted ones. A paid cart is finished, so the change
 * goes into a fresh cart (Commerce reads a paid cart as empty). A cart changed elsewhere meanwhile is read again
 * once. `version` (an agent quoting what it read) turns that retry off: a stale version changes nothing.
 */
export async function changeServerCart(
  ctx: ServerCartContext,
  next: (lines: readonly ServerCartLine[]) => readonly ServerCartLineInput[] | null,
  options: Readonly<{ version?: string | null; key?: string }> = {},
): Promise<ServerCartResult> {
  let key = readCartKey(ctx.cookies);
  for (let tries = 0; tries < 2; tries++) {
    let current: ServerCart = emptyCart();
    if (key) {
      const read = await callCommerce(ctx, "cart", {}, key);
      if (read.ok && read.checkout.state === "paid") key = null;
      else if (read.ok) current = read.cart ?? emptyCart();
      else if (read.code === "CAPABILITY_DENIED") key = null;
      else return failure(read.code);
    }
    if (!key) {
      key = await newCartKey(ctx);
      if (!key) return failure("UNAVAILABLE");
      writeCartCookies(ctx, key, null);
    }
    const wanted = next(current.lines);
    if (!wanted) return failure("CART_FULL", { cart: current });
    const lines = mightOverfill(wanted) ? await resolveLines(ctx, wanted) : wanted;
    if (typeof lines === "string") return failure(lines, { cart: current });
    const known = lines.filter((line) => "catalogItemId" in line);
    if (known.length > GUEST_CART_MAX_LINES || lines.some((line) => line.quantity > GUEST_CART_MAX_QUANTITY)) {
      return failure("CART_FULL", { cart: current });
    }
    const version = options.version !== undefined ? options.version : current.version;
    const answer = await callCommerce(ctx, "cart", {
      version,
      lines: lines.map(lineForCommerce),
      ...(options.key ? { key: options.key } : {}),
    }, key);
    if (answer.ok && answer.cart) {
      writeCartCookies(ctx, null, answer.cart.itemCount);
      return { ok: true, cart: answer.cart, checkout: answer.checkout };
    }
    if (!answer.ok && answer.code === "CONTENTION" && options.version === undefined && tries === 0) continue;
    if (!answer.ok) {
      const latest = await callCommerce(ctx, "cart", {}, key);
      return failure(answer.code, latest.ok ? { cart: latest.cart ?? emptyCart(), checkout: latest.checkout } : { cart: current });
    }
    return failure("UNAVAILABLE");
  }
  return failure("CONTENTION");
}

/**
 * Add one line to the cart. The same item merges into its line here, so adding to a full cart's existing item
 * is never refused as a new line; an item picked by its options merges in Commerce, which works out the variant.
 */
export function addToServerCart(ctx: ServerCartContext, line: ServerCartLineInput): Promise<ServerCartResult> {
  return changeServerCart(ctx, (lines) => {
    const id = "catalogItemId" in line ? line.catalogItemId : null;
    if (id && lines.some((existing) => existing.catalogItemId === id)) {
      return lines.map((existing) => existing.catalogItemId === id ? { ...existing, quantity: existing.quantity + line.quantity } : existing);
    }
    return [...lines, line];
  });
}

/**
 * The request body, read up to `limit` bytes as it streams in; null when it is longer. A missing or false
 * Content-Length never lets an oversized public form reach the parser.
 */
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A public form, parsed only after its body fits the limit. */
export async function readBoundedForm(request: Request, limit: number): Promise<FormData | null> {
  const body = await readBoundedBody(request, limit);
  if (!body) return null;
  const type = request.headers.get("content-type") ?? "";
  return new Response(body, { headers: { "content-type": type } }).formData().catch(() => null);
}

/** Set one item's quantity; 0 removes it. */
export function setServerCartQuantity(ctx: ServerCartContext, catalogItemId: string, quantity: number): Promise<ServerCartResult> {
  return changeServerCart(ctx, (lines) => lines.flatMap((line) =>
    line.catalogItemId !== catalogItemId ? [line] : quantity > 0 ? [{ catalogItemId, quantity }] : []));
}

/**
 * Start checkout from the saved cart with the shopper's contact. The playground's limiter and visitor-IP rule
 * apply here as they do on the plugin route.
 */
export async function startServerCheckout(ctx: ServerCartContext, contact: GuestCheckoutContact): Promise<ServerCartResult> {
  const key = readCartKey(ctx.cookies);
  if (!key) return failure("NO_CART");
  if (isPlayground(ctx.locals) && playgroundCheckoutConfigured(envOf(ctx.locals))) {
    if (!visitorIp(ctx.request)) return failure("UNAVAILABLE");
    const limiter = (ctx.locals as { __playgroundCheckoutLimiter?: unknown }).__playgroundCheckoutLimiter;
    if (await checkoutLimited(ctx.request, limiter)) return failure("RATE_LIMITED");
  }
  const answer = await callCommerce(ctx, "start", { contact }, key);
  if (!answer.ok) {
    const latest = await readServerCart(ctx);
    const extra = latest.ok ? { cart: latest.cart, checkout: latest.checkout } : {};
    // Commerce words its address refusals for shoppers ("The store does not ship to this country").
    if (answer.code === "INVALID_CART" && answer.message && /address|country|ship|phone|email|contact/iu.test(answer.message)) {
      return { ok: false, error: { code: answer.code, message: answer.message }, ...extra };
    }
    return failure(answer.code, extra);
  }
  const read = await readServerCart(ctx);
  return { ok: true, cart: read.cart ?? emptyCart(), checkout: answer.checkout };
}

const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];

export type ContactFieldError = Readonly<{ field: string; message: string }>;
export type ContactFormValues = Readonly<Record<string, string>>;

function formText(form: FormData, name: string, max = 200): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function formAddress(form: FormData, kind: "delivery" | "billing"): Record<AddressField, string> {
  return Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, formText(form, `${kind}[${field}]`)])) as Record<AddressField, string>;
}

function completeAddress(fields: Record<AddressField, string>): GuestCheckoutDelivery {
  return {
    name: fields.name,
    line1: fields.line1,
    ...(fields.line2 ? { line2: fields.line2 } : {}),
    city: fields.city,
    ...(fields.region ? { region: fields.region } : {}),
    postalCode: fields.postalCode,
    country: fields.country.toUpperCase(),
  };
}

function missingField(fields: Record<AddressField, string>): AddressField | null {
  return (["name", "line1", "city", "postalCode", "country"] as const).find((field) => !fields[field]) ?? null;
}

/**
 * The checkout form, as posted: email, a delivery address when the cart holds something physical, and a billing
 * address that defaults to "same as delivery" (billing-address-v1). Commerce checks it all again.
 */
export function readContactForm(form: FormData, needsDelivery: boolean):
  | Readonly<{ contact: GuestCheckoutContact; error: null; values: ContactFormValues }>
  | Readonly<{ contact: null; error: ContactFieldError; values: ContactFormValues }> {
  const email = formText(form, "email", 254);
  const delivery = formAddress(form, "delivery");
  const billing = formAddress(form, "billing");
  const same = needsDelivery && form.get("billingSame") !== null;
  const values: ContactFormValues = {
    email,
    ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`delivery[${field}]`, delivery[field]])),
    ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`billing[${field}]`, billing[field]])),
    billingSame: same ? "on" : "",
  };
  const fail = (field: string, message: string) => ({ contact: null, error: { field, message }, values });
  if (!email) return fail("email", "Enter your email address to continue.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return fail("email", "Enter a valid email address to continue.");
  let shipTo: GuestCheckoutDelivery | undefined;
  if (needsDelivery) {
    const missing = missingField(delivery);
    if (missing) return fail(`delivery[${missing}]`, "Complete the recipient, address, city, postal code, and country fields.");
    if (!/^[A-Za-z]{2}$/u.test(delivery.country)) return fail("delivery[country]", "Choose a country this store ships to.");
    if (delivery.country.toUpperCase() === "US" && !delivery.region) {
      return fail("delivery[region]", "Enter a state for United States delivery.");
    }
    shipTo = completeAddress(delivery);
  }
  if (same && shipTo) return { contact: { email, delivery: shipTo, billing: { ...shipTo } }, error: null, values };
  const missing = missingField(billing);
  if (missing || !/^[A-Za-z]{2}$/u.test(billing.country)) {
    return fail(`billing[${missing ?? "country"}]`, "Complete the billing name, address, city, postal code, and country fields.");
  }
  return { contact: { email, ...(shipTo ? { delivery: shipTo } : {}), billing: completeAddress(billing) }, error: null, values };
}

/** The add-to-cart form: a Commerce item id, or a product id with its chosen options (`options[Size]=Large`). */
export function readAddForm(form: FormData): ServerCartLineInput | null {
  const quantity = Number(formText(form, "quantity", 3) || "1");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > GUEST_CART_MAX_QUANTITY) return null;
  const id = formText(form, "id", 128);
  if (id) return { catalogItemId: id, quantity };
  const productId = formText(form, "productId", 128);
  const options: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    const match = /^options\[(.{1,80})\]$/u.exec(name);
    if (match && typeof value === "string" && value.trim()) options[match[1]!] = value.trim().slice(0, 120);
  }
  return productId && Object.keys(options).length ? { productId, options, quantity } : null;
}

/** The change form: one item's new quantity (0 removes it). */
export function readChangeForm(form: FormData): Readonly<{ id: string; quantity: number }> | null {
  const id = formText(form, "id", 128);
  const quantity = Number(formText(form, "quantity", 3));
  return id && Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= GUEST_CART_MAX_QUANTITY
    ? { id, quantity }
    : null;
}

/** A script (the page's own or an agent's) asks for JSON; a plain form gets a redirect. */
export function wantsJson(request: Request, url: URL): boolean {
  return url.pathname.endsWith(".js") || (request.headers.get("accept") ?? "").includes("application/json");
}

/** The cart as the page script and agents read it. */
export function cartJson(result: ServerCartResult) {
  const cart = result.cart ?? emptyCart();
  return {
    ok: result.ok,
    cart: { lines: cart.lines, version: cart.version, itemCount: cart.itemCount, expiresAt: cart.expiresAt },
    ...(result.checkout ? {
      checkout: {
        state: result.checkout.state,
        open: result.checkout.attemptId !== null && result.checkout.state !== "released-retry" && result.checkout.state !== "paid",
        continueUrl: result.checkout.redirectUrl,
      },
    } : {}),
    ...(result.ok ? {} : { error: result.error }),
  };
}
