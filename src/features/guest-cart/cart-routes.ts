import type { APIContext, APIRoute } from "astro";

import {
  addToServerCart,
  cartJson,
  changeServerCart,
  readAddForm,
  readChangeForm,
  readServerCart,
  sameStoreRequest,
  setServerCartQuantity,
  wantsJson,
  type ServerCartContext,
  type ServerCartLineInput,
  type ServerCartResult,
} from "./server-cart.js";

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function contextOf(context: APIContext): ServerCartContext {
  return { locals: context.locals, request: context.request, url: context.url, cookies: context.cookies };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function statusFor(result: ServerCartResult): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "CONTENTION":
    case "CHECKOUT_FROZEN": return 409;
    case "PRODUCT_UNAVAILABLE":
    case "CART_FULL":
    case "INVALID_CART":
    case "INVALID_INPUT": return 422;
    case "NO_CART": return 200;
    default: return 503;
  }
}

/** A path on this store to send a plain form back to, from the Referer; anything else lands on the cart. */
function backTo(context: APIContext, fallback: string): string {
  try {
    const referer = new URL(context.request.headers.get("referer") ?? "");
    if (referer.origin === context.url.origin && referer.pathname.startsWith("/") && !referer.pathname.startsWith("//")) {
      referer.searchParams.delete("cart_error");
      referer.searchParams.delete("added");
      return referer.pathname + referer.search;
    }
  } catch {
    // No usable Referer.
  }
  return fallback;
}

function withQuery(path: string, name: string, value: string): string {
  const url = new URL(path, "https://store.invalid");
  url.searchParams.set(name, value);
  return url.pathname + url.search;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location, ...NO_STORE } });
}

async function readBody(context: APIContext): Promise<FormData | Record<string, unknown> | null> {
  const declared = context.request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  const type = context.request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const text = await context.request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
      const value: unknown = JSON.parse(text || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    }
    return await context.request.formData();
  } catch {
    return null;
  }
}

function asForm(body: FormData | Record<string, unknown>): FormData {
  if (body instanceof FormData) return body;
  const form = new FormData();
  for (const [name, value] of Object.entries(body)) {
    if (name === "options" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [option, choice] of Object.entries(value)) if (typeof choice === "string") form.set(`options[${option}]`, choice);
    } else if (typeof value === "string" || typeof value === "number") {
      form.set(name, String(value));
    }
  }
  return form;
}

function refused(context: APIContext, code: string): Response {
  const result: ServerCartResult = { ok: false, error: { code, message: "That cart change could not be made." } };
  return wantsJson(context.request, context.url)
    ? json(cartJson(result), code === "FORBIDDEN" ? 403 : 400)
    : redirect(withQuery(backTo(context, "/cart"), "cart_error", code === "FORBIDDEN" ? "INVALID_CART" : code));
}

/** GET /cart.js: the cart, as the page script and agents read it (Shopify's /cart.js). */
export const getCart: APIRoute = async (context) => json(cartJson(await readServerCart(contextOf(context))));

/** POST /cart/add (a plain form) and /cart/add.js (script): add one item, Shopify-style. */
export const postAdd: APIRoute = async (context) => {
  if (!sameStoreRequest(context)) return refused(context, "FORBIDDEN");
  const body = await readBody(context);
  const line = body ? readAddForm(asForm(body)) : null;
  if (!line) return refused(context, "INVALID_CART");
  const result = await addToServerCart(contextOf(context), line);
  if (wantsJson(context.request, context.url)) return json(cartJson(result), statusFor(result));
  return result.ok
    ? redirect(withQuery("/cart", "added", String(line.quantity)))
    : redirect(withQuery(backTo(context, "/cart"), "cart_error", result.error.code));
};

/** POST /cart/change (a plain form) and /cart/change.js: set one item's quantity; 0 removes it. */
export const postChange: APIRoute = async (context) => {
  if (!sameStoreRequest(context)) return refused(context, "FORBIDDEN");
  const body = await readBody(context);
  const change = body ? readChangeForm(asForm(body)) : null;
  if (!change) return refused(context, "INVALID_CART");
  const result = await setServerCartQuantity(contextOf(context), change.id, change.quantity);
  if (wantsJson(context.request, context.url)) return json(cartJson(result), statusFor(result));
  return result.ok ? redirect("/cart") : redirect(withQuery("/cart", "cart_error", result.error.code));
};

function agentLines(value: unknown): ServerCartLineInput[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const lines: ServerCartLineInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const line = raw as { catalogItemId?: unknown; id?: unknown; productId?: unknown; options?: unknown; quantity?: unknown };
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    const id = line.catalogItemId ?? line.id;
    if (typeof id === "string" && id) lines.push({ catalogItemId: id, quantity });
    else if (typeof line.productId === "string" && line.productId && line.options && typeof line.options === "object" &&
        !Array.isArray(line.options) && Object.values(line.options).every((choice) => typeof choice === "string")) {
      lines.push({ productId: line.productId, options: line.options as Record<string, string>, quantity });
    } else return null;
  }
  return lines;
}

/**
 * POST /cart/update.js: an agent replaces the whole cart, quoting the version it read
 * (commerce-cart-agent-writes-20261113). A stale version changes nothing and answers the current cart.
 */
export const postUpdate: APIRoute = async (context) => {
  if (!sameStoreRequest(context)) return refused(context, "FORBIDDEN");
  const body = await readBody(context);
  if (!body || body instanceof FormData) return refused(context, "INVALID_CART");
  const lines = agentLines(body.lines);
  const version = body.version;
  const key = body.key;
  if (!lines || (version !== null && typeof version !== "string") ||
      (key !== undefined && (typeof key !== "string" || !key || key.length > 128))) return refused(context, "INVALID_CART");
  const result = await changeServerCart(contextOf(context), () => lines,
    { version, ...(typeof key === "string" ? { key } : {}) });
  return json(cartJson(result), statusFor(result));
};
