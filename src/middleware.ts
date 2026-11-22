import { defineMiddleware } from "astro:middleware";
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
import {
   ensurePlaygroundDemoCatalog,
} from "./features/playground/demo-commerce-seed.js";
import { ensureDemoCatalogThroughCommerce, type CommerceSeedRuntime } from "./features/playground/demo-registry-seed.js";
import {
  filterPublicSearchApiResponse,
} from "./features/store-shell/index.js";
import { storefrontUpgrader } from "./features/store-shell/storefront-upgrades.js";
import { isDemoCatalogProfile } from "./features/playground/demo-products.js";
import { madeBeforeRegistryCommerce, restartPlaygroundStore } from "./features/playground/store-generation.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "./features/guest-cart/checkout-protocol.js";
import {
  playgroundCheckoutConfigured,
  withCheckoutVisitor,
} from "./features/playground-checkout/payments-port.js";
import { playgroundAttemptBelongsToVisitor } from "./features/playground-checkout/binding-auth.js";
import { playgroundCheckoutBindingsFor } from "./features/playground-checkout/binding-store.js";
import { storedUser, withProductOnSale, type OnSaleRuntime } from "./features/product-on-sale/index.js";
import { isStorefrontPath, siteIsStaging, withStagingRobots } from "./features/site-visibility/index.js";
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
// Runs the template's storefront upgrades a store set up from an older seed hasn't run, once per isolate.
const upgradeStorefrontSchema = storefrontUpgrader();
let demoProfileSeeded = false;


const NATIVE_GUEST_CHECKOUT_POST_PATH =
  /^\/_emdash\/api\/plugins\/dinkus-commerce\/checkout\/guest\/(prepare|cart|start)$/;

// While the site is in staging, every storefront response asks search engines to stay away.
export const onRequest = defineMiddleware(async (context, next) => {
  const staging = isStorefrontPath(context.url.pathname) && await siteIsStaging();
  // storeRequest answers every request with a Response; anything else passes through as it came.
  const response = await storeRequest(context, next);
  if (!staging || !(response instanceof Response)) return response as Response;
  return withStagingRobots(response);
});

const storeRequest = defineMiddleware(async (context, next) => {
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
      slashlessPath === "/track-order" ||
      slashlessPath === "/review" ||
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
  // Resolve (and publish on locals) the persistent binding store once, so a cart read authorizes against
  // the same store start wrote.
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
    };
  };

  async function checkoutRouteAdmitted(): Promise<boolean> {
    const installed = { runtime: context.locals.emdash, request: context.request };
    // Readiness is advisory for new checkout entry. An existing capability must
    // still reach Commerce's current cart and start checks when the advisory is stale.
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
      // A store the playground made before it ran Commerce's Registry build starts over (Ronald, 1 Nov 2026).
      if (await madeBeforeRegistryCommerce(db).catch(() => false)) {
        const restarted = restartPlaygroundStore(context.request);
        applySecurityHeaders(restarted.headers);
        return restarted;
      }
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
      // A cart read is also the status check: a paid order shows only to the visitor who paid.
      if (checkoutKind === "cart") {
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

  if (pathForms.some((path) => NATIVE_GUEST_CHECKOUT_POST_PATH.test(path))) {
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
