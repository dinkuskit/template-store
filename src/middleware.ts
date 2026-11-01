import { defineMiddleware } from "astro:middleware";
import { PluginStorageRepository } from "emdash";
import {
  PUBLIC_STOREFRONT_SEARCH_COLLECTIONS,
  applySecurityHeaders,
  decodedForms,
  evaluatePublicBoundary,
  isExactGuestCheckoutPath,
  slashlessRedirectPath,
  validatePublicSearchQuery,
} from "./features/security/public-boundary.js";
import { acquireGuestCheckoutAdmission, canDispatchInstalledGuestCheckout } from "./features/guest-cart/checkout-admission.js";
import { GUEST_CHECKOUT_STATUS_ENDPOINT } from "./features/guest-cart/checkout-protocol.js";
import {
   ensurePlaygroundDemoCatalog,
} from "./features/playground/demo-commerce-seed.js";
import { ensureDemoCatalogThroughCommerce, type CommerceSeedRuntime } from "./features/playground/demo-registry-seed.js";
import {
  filterPublicSearchApiResponse,
} from "./features/store-shell/index.js";
import { storefrontUpgrader } from "./features/store-shell/storefront-upgrades.js";
import { isDemoCatalogProfile } from "./features/playground/demo-products.js";
import {
  ensureDemoShopperOrder,
  isPlaygroundLeadStorageConfigured,
  recordVerifiedPlaygroundLead,
  revokeShopperSessionById,
  withShopperAccountRequest,
} from "./features/shopper-account/playground-runtime.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "./features/guest-cart/checkout-protocol.js";
import {
  playgroundCheckoutConfigured,
  withCheckoutVisitor,
} from "./features/playground-checkout/payments-port.js";
import { playgroundAttemptBelongsToVisitor } from "./features/playground-checkout/binding-auth.js";
import { playgroundCheckoutBindingsFor } from "./features/playground-checkout/binding-store.js";
import { scheduledSaleSweeper, storedUser, withProductOnSale, type OnSaleRuntime, type PendingSales } from "./features/product-on-sale/index.js";
import { PENDING_SALES, PRODUCT_URL_PLUGIN_ID } from "./features/product-url-plugin/index.js";
import {
  checkoutJsonError,
  checkoutLimited,
  checkoutRouteKind,
  isCheckoutEnabled,
  MAX_CHECKOUT_BODY_BYTES,
  SANDBOX_CLIENT_IP_MESSAGE,
  SANDBOX_RATE_LIMITED_MESSAGE,
  visitorIp,
  validateCheckoutBody,
} from "./features/playground-checkout/index.js";

/** Playground sessions whose Commerce demo catalog was ensured in this isolate. */
const seededPlaygroundSessions = new Set<string>();
// Puts pages EmDash published on a schedule on sale, at most once a minute per isolate.
const sweepScheduledSales = scheduledSaleSweeper();
// Runs the template's storefront upgrades a store set up from an older seed hasn't run, once per isolate.
const upgradeStorefrontSchema = storefrontUpgrader();
let demoProfileSeeded = false;


const NATIVE_GUEST_CHECKOUT_POST_PATH =
  /^\/_emdash\/api\/plugins\/dinkus-commerce\/checkout\/guest\/(prepare|start|status)$/;
const NATIVE_SHOPPER_ACCOUNT_PATH =
  /^\/_emdash\/api\/plugins\/dinkus-commerce\/account\/(sign-in\/start|sign-in\/verify|sign-out|orders|profile)$/;
const SHOPPER_ACCOUNT_ROUTE_PATH = new RegExp(
  `^/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/account/(sign-in/start|sign-in/verify|sign-out|orders|profile)$`,
);

type ShopperAccountRouteKind =
  | "sign-in/start"
  | "sign-in/verify"
  | "sign-out"
  | "orders"
  | "profile";

function shopperAccountRouteKind(pathname: string): ShopperAccountRouteKind | null {
  try {
    for (const form of decodedForms(pathname)) {
      const match = form.match(SHOPPER_ACCOUNT_ROUTE_PATH);
      if (match?.[1]) {
        return match[1] as ShopperAccountRouteKind;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  let pathForms: string[];
  try {
    pathForms = decodedForms(context.url.pathname);
  } catch {
    const response = Response.json({ error: "Invalid path." }, { status: 403 });
    applySecurityHeaders(response.headers);
    return response;
  }
  if (context.url.pathname === "/cart/") {
    const response = new Response(null, {
      status: 302,
      headers: { Location: new URL("/cart", context.url).href },
    });
    applySecurityHeaders(response.headers);
    return response;
  }
  const slashlessPath = slashlessRedirectPath(context.url.pathname);
  if (
    slashlessPath &&
    (slashlessPath === "/checkout" ||
      slashlessPath === "/account" ||
      slashlessPath === "/shipping" ||
      slashlessPath === "/returns" ||
      slashlessPath === "/search" ||
      slashlessPath.startsWith("/feeds/")) &&
    (context.request.method === "GET" || context.request.method === "HEAD")
  ) {
    const response = new Response(null, {
      status: 301,
      headers: {
        Location: new URL(slashlessPath + context.url.search, context.url).href,
        "Cache-Control": "no-store",
      },
    });
    applySecurityHeaders(response.headers);
    return response;
  }
  const isCloudflare =
    process.env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    process.env.ASTRO_ADAPTER === "cloudflare" ||
    Boolean((context.locals as { runtime?: unknown }).runtime);

  const isProofMode =
    process.env.DINKUS_STOREFRONT_PROFILE === "proof" ||
    process.env.DINKUS_PROOF_MODE === "1";
  const isPlayground =
    Boolean((context.locals as { __playgroundDb?: unknown }).__playgroundDb);
  const playgroundEnv =
    ((context.locals as { __playgroundEnv?: Record<string, unknown> }).__playgroundEnv ??
      process.env) as Record<string, unknown>;
  (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv = playgroundEnv;
  // Resolve (and publish on locals) the persistent binding store once, so the
  // /api/checkout/status route authorizes against the same store start wrote.
  const playgroundBindings = isPlayground ? playgroundCheckoutBindingsFor(context.locals) : undefined;

  // Publishing a product page puts its Commerce product on sale. Every store, the playground included, runs
  // Commerce's Registry build (template-one-build-registry-20261031).
  const productOnSale = () => {
    const runtime = context.locals.emdash as unknown as OnSaleRuntime | undefined;
    const user = (context.locals as { user?: unknown }).user;
    return {
      request: context.request,
      url: context.url,
      runtime,
      user,
      commercePluginId: COMMERCE_REGISTRY_RUNTIME_ID,
      currentUser: () => (runtime ? storedUser(runtime, user) : Promise.resolve(user)),
      pendingSales: runtime?.db
        ? (new PluginStorageRepository(runtime.db as never, PRODUCT_URL_PLUGIN_ID, PENDING_SALES, []) as unknown as PendingSales)
        : undefined,
    };
  };

  async function checkoutRouteAdmitted(): Promise<boolean> {
    const installed = { runtime: context.locals.emdash, request: context.request };
    // Readiness is advisory for new checkout entry. An existing capability must
    // still reach Commerce's current start/status checks when the advisory is stale.
    return pathForms.some((path) => path.endsWith("/prepare"))
      ? Boolean(await acquireGuestCheckoutAdmission(installed))
      : canDispatchInstalledGuestCheckout(installed);
  }

  // Sandbox checkout guard (playground/demo): flag, limiter and body
  // validation run before the per-visitor DO/database is touched below.
  const checkoutKind = checkoutRouteKind(context.url.pathname);
  if (checkoutKind && (isPlayground || isDemoCatalogProfile())) {
    const guarded = await guardSandboxCheckout(context.request, checkoutKind,
      (context.locals as { __playgroundCheckoutLimiter?: unknown }).__playgroundCheckoutLimiter, isPlayground);
    if (guarded) {
      applySecurityHeaders(guarded.headers);
      return guarded;
    }
    if (checkoutKind === "status" && isPlayground && playgroundCheckoutConfigured(playgroundEnv)) {
      const statusAttemptId = await readStatusAttemptId(context.request);
      if (statusAttemptId === TOO_LARGE) {
        const refused = checkoutJsonError(413, "Checkout request is too large.");
        applySecurityHeaders(refused.headers);
        return refused;
      }
      const sessionId = context.cookies.get("emdash_playground")?.value ?? "";
      if (statusAttemptId !== null && !(await playgroundAttemptBelongsToVisitor(statusAttemptId, sessionId, playgroundBindings, playgroundEnv))) {
        const refused = checkoutJsonError(403, "Checkout visitor session is not authorized.");
        applySecurityHeaders(refused.headers);
        return refused;
      }
    }
  }

  const isPublicSearchApi =
    context.url.pathname === "/_emdash/api/search" ||
    context.url.pathname === "/_emdash/api/search/suggest";

  if (context.url.pathname === "/search" || isPublicSearchApi) {
    const searchCheck = validatePublicSearchQuery(context.url.search);
    if (!searchCheck.allowed) {
      const refused = Response.json(
        { error: searchCheck.reason ?? "Forbidden" },
        { status: searchCheck.status },
      );
      applySecurityHeaders(refused.headers);
      return refused;
    }
    if (isPublicSearchApi && !context.url.searchParams.has("collections")) {
      context.url.searchParams.set(
        "collections",
        PUBLIC_STOREFRONT_SEARCH_COLLECTIONS.join(","),
      );
    }
  }

  if (isPlayground) {
    // EmDash seeds CMS content into each per-visitor DB; the visitor's Commerce (its Registry build, installed
    // in the store) is set up through its own routes once per session: catalog, connection, sample orders.
    // A visitor's requests are an Administrator's, so they carry EmDash's full runtime.
    const session = context.cookies.get("emdash_playground")?.value;
    const runtime = context.locals.emdash as unknown as CommerceSeedRuntime | undefined;
    if (session && !seededPlaygroundSessions.has(session) && typeof runtime?.handlePluginApiRoute === "function") {
      const db = (context.locals as { __playgroundDb: Parameters<typeof ensurePlaygroundDemoCatalog>[0] }).__playgroundDb;
      seededPlaygroundSessions.add(session);
      await ensurePlaygroundDemoCatalog(db, { runtime, origin: context.url.origin }).catch((error: unknown) => {
        // A fresh store builds Commerce's indexes on its first requests; the next request tries again.
        seededPlaygroundSessions.delete(session);
        console.error("[playground-seed] failed", error);
      });
    }
  } else if (context.locals.emdash) {
    // An older store takes the template's newer schema on its own database, D1 or
    // SQLite, as EmDash takes its migrations (template-store-self-upgrade-20261028).
    // Each playground visitor's database is seeded fresh, so it needs none.
    await upgradeStorefrontSchema(async () => (await import("emdash/runtime")).getDb(), {
      mode: process.env.EMDASH_MIGRATIONS_MODE ?? import.meta.env.EMDASH_MIGRATIONS_MODE,
    });
  }
  const demoSeedRuntime = context.locals.emdash as unknown as Parameters<typeof ensureDemoCatalogThroughCommerce>[0] | undefined;
  if (!isPlayground && isDemoCatalogProfile() && !demoProfileSeeded && typeof demoSeedRuntime?.handlePluginApiRoute === "function") {
    // The demo store (proof storefront profile) gets the same create-only-if-missing demo catalog, written
    // through the installed Commerce Registry build's own private routes. Those need EmDash's full runtime,
    // which it attaches to a signed-in person's requests (an anonymous visitor's requests carry only the
    // public dispatcher), so the seed runs on the first signed-in request: the setup and sign-in calls every
    // proof run makes first, or the owner opening the admin of a fresh demo. Shipping stores never seed. A
    // fresh install builds Commerce's unique indexes on its first requests, so a refused seed is tried again.
    demoProfileSeeded = true;
    await ensureDemoCatalogThroughCommerce(demoSeedRuntime, COMMERCE_REGISTRY_RUNTIME_ID, context.url.origin)
      .catch((error: unknown) => { demoProfileSeeded = false; console.error("[demo-seed] failed", error); });
  }

  // Sandbox checkout opens ONLY for a playground session with the flag on and
  // every Payments value present; the request has already passed body
  // validation, the visitor-IP check and the limiter above. The cart's call
  // reaches the visitor's own Commerce (its Registry build), whose Payments
  // calls pass the playground's checkout guard with this visitor's IP and session.
  if (checkoutKind && isPlayground && playgroundCheckoutConfigured(playgroundEnv)) {
    const clientIp = visitorIp(context.request);
    if (!clientIp && checkoutKind === "start") {
      const refused = checkoutJsonError(400, SANDBOX_CLIENT_IP_MESSAGE);
      applySecurityHeaders(refused.headers);
      return refused;
    }
    const sessionId = context.cookies.get("emdash_playground")?.value ?? "";
    const response = await withCheckoutVisitor(clientIp ?? "", sessionId, async () => {
      const commerceResponse = await next();
      if (checkoutKind === "status") {
        return authorizePlaygroundStatusResponse(commerceResponse, sessionId, playgroundBindings, playgroundEnv);
      }
      return commerceResponse;
    }, playgroundBindings);
    applySecurityHeaders(response.headers);
    return response;
  }
  // Without the full checkout configuration the playground's checkout routes never reach Commerce.
  if (checkoutKind && isPlayground) {
    const refused = checkoutJsonError(503, "Playground checkout is unavailable.");
    applySecurityHeaders(refused.headers);
    return refused;
  }

  // Status recovery (/api/checkout/status) dispatches in-process to the visitor's
  // Commerce; give its Payments lookup the same visitor context.
  if (isPlayground && context.url.pathname === GUEST_CHECKOUT_STATUS_ENDPOINT &&
      playgroundCheckoutConfigured(playgroundEnv)) {
    const sessionId = context.cookies.get("emdash_playground")?.value ?? "";
    const statusAttemptId = await readStatusAttemptId(context.request);
    if (statusAttemptId === TOO_LARGE) {
      const refused = checkoutJsonError(413, "Checkout request is too large.");
      applySecurityHeaders(refused.headers);
      return refused;
    }
    if (statusAttemptId !== null && !(await playgroundAttemptBelongsToVisitor(statusAttemptId, sessionId, playgroundBindings, playgroundEnv))) {
      const refused = checkoutJsonError(403, "Checkout visitor session is not authorized.");
      applySecurityHeaders(refused.headers);
      return refused;
    }
    const response = await withCheckoutVisitor(visitorIp(context.request) ?? "", sessionId, () => next(), playgroundBindings);
    applySecurityHeaders(response.headers);
    return response;
  }

  // The playground wraps the visitor's Commerce account routes with its updates opt-in, sign-in limiter and
  // verified-lead record; other stores reach the installed plugin's own account routes directly.
  const accountKind = shopperAccountRouteKind(context.url.pathname);
  if (accountKind && isPlayground) {
    const response = await dispatchPlaygroundShopperAccount(
      context.locals,
      context.request,
      context.url,
      accountKind,
      isPlayground,
      playgroundEnv,
    );
    applySecurityHeaders(response.headers);
    return response;
  }

  if (isCloudflare && !isProofMode && !isPlayground) {
    const { request, url } = context;
    const check = evaluatePublicBoundary(
      request.method,
      url.pathname,
      url.search,
      url.href,
    );
    if (!check.allowed) {
      const response = new Response(
        JSON.stringify({ error: check.reason ?? "Forbidden" }),
        {
          status: check.status,
          headers: { "Content-Type": "application/json" },
        },
      );
      applySecurityHeaders(response.headers);
      return response;
    }

    if (isExactGuestCheckoutPath(url.pathname)) {
      const admission = await checkoutRouteAdmitted();
      if (!admission) {
        const response = new Response(
          JSON.stringify({ error: "Checkout is not available yet." }),
          {
            status: 503,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
        applySecurityHeaders(response.headers);
        return response;
      }
    }

    await sweepScheduledSales(productOnSale());
    const rawResponse = await withProductOnSale(productOnSale(), () => next());
    const response = isPublicSearchApi
      ? await filterPublicSearchApiResponse(rawResponse, {
          runtime: context.locals.emdash,
          request: context.request,
        })
      : rawResponse;
    applySecurityHeaders(response.headers);
    return response;
  }

  if (isExactGuestCheckoutPath(context.url.pathname)) {
    const admission = await checkoutRouteAdmitted();
    if (!admission) {
      const response = new Response(
        JSON.stringify({ error: "Checkout is not available yet." }),
        {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        },
      );
      applySecurityHeaders(response.headers);
      return response;
    }
  }

  if (pathForms.some((path) => NATIVE_GUEST_CHECKOUT_POST_PATH.test(path) || NATIVE_SHOPPER_ACCOUNT_PATH.test(path))) {
    const response = new Response(
      JSON.stringify({ error: "Native or source-alias checkout is not a supported install." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    );
    applySecurityHeaders(response.headers);
    return response;
  }

  await sweepScheduledSales(productOnSale());
  const rawResponse = await withProductOnSale(productOnSale(), () => next());
  const response = isPublicSearchApi
    ? await filterPublicSearchApiResponse(rawResponse, {
        runtime: context.locals.emdash,
        request: context.request,
      })
    : rawResponse;
  applySecurityHeaders(response.headers);
  return response;
});

async function guardSandboxCheckout(
  request: Request,
  kind: NonNullable<ReturnType<typeof checkoutRouteKind>>,
  limiter: unknown,
  isPlayground: boolean,
): Promise<Response | null> {
  // Flag off: fall through to today's closed gates unchanged.
  if (!isCheckoutEnabled()) return null;
  if (request.method !== "POST") return checkoutJsonError(405, "Method not allowed.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_CHECKOUT_BODY_BYTES)) {
    return checkoutJsonError(413, "Checkout request is too large.");
  }
  const raw = await boundedCheckoutBody(request);
  if (raw === TOO_LARGE) return checkoutJsonError(413, "Checkout request is too large.");
  if (raw === null || !validateCheckoutBody(kind, raw).ok) {
    return checkoutJsonError(400, "Checkout request is invalid.");
  }
  // Payments needs the visitor IP for its per-visitor limit; refuse locally without one.
  if (kind === "start" && isPlayground && !visitorIp(request)) {
    return checkoutJsonError(400, SANDBOX_CLIENT_IP_MESSAGE);
  }
  // The playground limiter applies per visitor; the demo profile has no binding.
  if (kind === "start" && isPlayground && await checkoutLimited(request, limiter)) {
    const limited = checkoutJsonError(429, SANDBOX_RATE_LIMITED_MESSAGE);
    limited.headers.set("Retry-After", "600");
    return limited;
  }
  return null;
}

const TOO_LARGE = Symbol("checkout-body-too-large");

async function boundedCheckoutBody(request: Request): Promise<string | null | typeof TOO_LARGE> {
  if (!request.body) return "";
  const reader = request.clone().body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_CHECKOUT_BODY_BYTES) {
        // This reader is one branch of request.clone()'s tee. Cancelling a tee
        // branch settles only once the other branch is consumed or cancelled,
        // and the original body stays unread here, so never await it: reply
        // 413 now and let the runtime discard the original request body.
        reader.cancel().catch(() => {});
        return TOO_LARGE;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readStatusAttemptId(request: Request): Promise<string | null | typeof TOO_LARGE> {
  const raw = await boundedCheckoutBody(request);
  if (raw === TOO_LARGE) return TOO_LARGE;
  if (raw === null || raw === "") return null;
  try {
    const body = JSON.parse(raw) as { attemptId?: unknown };
    return typeof body.attemptId === "string" && body.attemptId.length > 0 ? body.attemptId : null;
  } catch {
    return null;
  }
}

type PublicPluginResult = {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: { code?: string; message?: string; details?: unknown };
};
type PublicPluginDispatcher = (pluginId: string, method: string, path: string, request: Request) => Promise<PublicPluginResult>;

/** A terminal status is shown only to the visitor whose session started that payment. */
async function authorizePlaygroundStatusResponse(
  response: Response,
  sessionId: string,
  bindings: Parameters<typeof playgroundAttemptBelongsToVisitor>[2],
  env: Record<string, unknown>,
): Promise<Response> {
  try {
    const body = await response.clone().json() as {
      data?: { checkout?: { state?: unknown; attemptId?: unknown; order?: unknown } };
      checkout?: { state?: unknown; attemptId?: unknown; order?: unknown };
    };
    const checkout = body.data?.checkout ?? body.checkout;
    const terminal = checkout?.state === "paid" || checkout?.order !== null && checkout?.order !== undefined;
    if (!terminal) return response;
    if (typeof checkout?.attemptId !== "string" ||
        !(await playgroundAttemptBelongsToVisitor(checkout.attemptId, sessionId, bindings, env))) {
      return checkoutJsonError(403, "Checkout visitor session is not authorized.");
    }
    return response;
  } catch {
    return checkoutJsonError(503, "Checkout status unavailable.");
  }
}

async function resolveDemoOrPlaygroundDb(
  locals: unknown,
  isPlayground: boolean,
): Promise<Parameters<typeof ensureDemoShopperOrder>[0] | null> {
  if (isPlayground) {
    const db = (locals as { __playgroundDb?: Parameters<typeof ensureDemoShopperOrder>[0] } | undefined)
      ?.__playgroundDb;
    return db ?? null;
  }
  try {
    const { getDb } = await import("emdash/runtime");
    return (await getDb()) as Parameters<typeof ensureDemoShopperOrder>[0];
  } catch {
    return null;
  }
}

async function dispatchPlaygroundShopperAccount(
  locals: unknown,
  request: Request,
  url: URL,
  kind: ShopperAccountRouteKind,
  isPlayground: boolean,
  env: Record<string, unknown>,
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  const dispatch = (locals as { emdash?: { handlePublicPluginApiRoute?: PublicPluginDispatcher } } | undefined)
    ?.emdash?.handlePublicPluginApiRoute;
  if (typeof dispatch !== "function") {
    return Response.json(
      { success: false, error: { code: "UNAVAILABLE", message: "Account service is not available right now." } },
      { status: 503, headers },
    );
  }
  const method = request.method.toUpperCase();
  if (kind === "orders" && method !== "GET") {
    return Response.json(
      { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405, headers },
    );
  }
  if ((kind === "sign-in/start" || kind === "sign-in/verify" || kind === "sign-out") && method !== "POST") {
    return Response.json(
      { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405, headers },
    );
  }
  if (kind === "profile" && method !== "GET" && method !== "POST") {
    return Response.json(
      { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405, headers },
    );
  }

  const db = await resolveDemoOrPlaygroundDb(locals, isPlayground);
  if (db) {
    await ensureDemoShopperOrder(db).catch(() => {});
  }

  let forwardedBody: string | undefined;
  let optedIn = false;
  if (method === "POST") {
    const raw = await boundedCheckoutBody(request);
    if (raw === TOO_LARGE) {
      return Response.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Account request is too large." } },
        { status: 413, headers },
      );
    }
    if (raw === null) {
      return Response.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Account request body is invalid." } },
        { status: 400, headers },
      );
    }
    if (kind === "sign-in/start" || kind === "sign-in/verify") {
      let parsed: Record<string, unknown>;
      try {
        const candidate = raw === "" ? {} : (JSON.parse(raw) as unknown);
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          throw new Error("not-object");
        }
        parsed = { ...(candidate as Record<string, unknown>) };
      } catch {
        return Response.json(
          { success: false, error: { code: "INVALID_INPUT", message: "Account request body must be a JSON object." } },
          { status: 400, headers },
        );
      }
      optedIn = parsed.optInUpdates === true;
      delete parsed.optInUpdates;
      if ((kind === "sign-in/start" || kind === "sign-in/verify") && !optedIn) {
        return Response.json(
          {
            success: false,
            error: {
              code: "OPT_IN_REQUIRED",
              message:
                "Check the updates opt-in box to receive a 6-digit email PIN, or use the instant demo account button below.",
            },
          },
          { status: 400, headers },
        );
      }
      if ((kind === "sign-in/start" || kind === "sign-in/verify") && isPlayground && !isPlaygroundLeadStorageConfigured(env)) {
        return Response.json(
          {
            success: false,
            error: {
              code: "UNAVAILABLE",
              message: "Durable playground opt-in storage is not configured right now.",
            },
          },
          { status: 503, headers },
        );
      }
      if (kind === "sign-in/start" && isPlayground) {
        const limiter = (locals as { __playgroundCheckoutLimiter?: unknown } | undefined)?.__playgroundCheckoutLimiter;
        if (limiter && (await checkoutLimited(request, limiter))) {
          return Response.json(
            {
              success: false,
              error: {
                code: "RATE_LIMITED",
                message: "Too many sign-in PIN requests from this connection. Please wait a few minutes or use the instant demo account.",
              },
            },
            { status: 429, headers: { ...headers, "Retry-After": "60" } },
          );
        }
      }
      forwardedBody = JSON.stringify(parsed);
    } else {
      forwardedBody = raw;
    }
  }

  const target = new URL(`/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/account/${kind}`, url);
  const forwarded = new Request(target, {
    method,
    headers: request.headers,
    ...(forwardedBody !== undefined ? { body: forwardedBody } : {}),
  });
  const result = await withShopperAccountRequest(url.origin, env, () =>
    dispatch(COMMERCE_REGISTRY_RUNTIME_ID, method, `account/${kind}`, forwarded),
  );
  if (!result?.success) {
    const code = result?.error?.code ?? "PLUGIN_ERROR";
    const message = code === "INTERNAL_ERROR" ? "Plugin route error" : result?.error?.message ?? "Plugin route error";
    const status = result?.status ?? (code === "NOT_FOUND" ? 404 : 400);
    return Response.json({ success: false, error: { code, message } }, { status, headers });
  }
  // Commerce's Registry routes refuse in-band ({ ok: false, error }), as in every store: a wrong or expired
  // PIN, a rate limit or a denied session goes back to the shopper as Commerce gave it, and records no lead.
  if ((result.data as { ok?: unknown } | null | undefined)?.ok === false) {
    return Response.json({ success: true, data: result.data }, { status: 200, headers });
  }
  if (kind === "sign-in/verify" && result.data && typeof result.data === "object") {
    const profile = (result.data as { profile?: { email?: unknown } }).profile;
    const capability = (result.data as { capability?: { sessionId?: unknown } }).capability;
    if (typeof profile?.email !== "string") {
      return Response.json(
        { success: false, error: { code: "UNAVAILABLE", message: "Could not record verified email opt-in." } },
        { status: 503, headers },
      );
    }
    try {
      const recorded = await recordVerifiedPlaygroundLead(profile.email, env);
      if (!recorded) {
        throw new Error("Lead was not recorded.");
      }
    } catch {
      if (db && typeof capability?.sessionId === "string") {
        await revokeShopperSessionById(db, capability.sessionId).catch(() => {});
      }
      return Response.json(
        { success: false, error: { code: "UNAVAILABLE", message: "Could not record verified email opt-in." } },
        { status: 503, headers },
      );
    }
  }
  return Response.json({ success: true, data: result.data }, { status: 200, headers });
}
