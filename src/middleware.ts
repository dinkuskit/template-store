import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  decodedForms,
  evaluatePublicBoundary,
  isExactGuestCheckoutPath,
} from "./features/security/public-boundary.js";
import { acquireGuestCheckoutAdmission, canDispatchInstalledGuestCheckout } from "./features/guest-cart/checkout-admission.js";
import { ensurePlaygroundDemoCatalog } from "./features/playground/demo-commerce-seed.js";
import { isDemoCatalogProfile } from "./features/playground/demo-products.js";
import { playgroundCheckoutConfigured, withCheckoutVisitor } from "./features/playground-checkout/payments-port.js";
import {
  checkoutJsonError,
  checkoutLimited,
  checkoutRouteKind,
  nativeCheckoutPath,
  isCheckoutEnabled,
  MAX_CHECKOUT_BODY_BYTES,
  SANDBOX_CLIENT_IP_MESSAGE,
  SANDBOX_RATE_LIMITED_MESSAGE,
  visitorIp,
  validateCheckoutBody,
} from "./features/playground-checkout/index.js";

/** Playground sessions whose Commerce demo catalog was ensured in this isolate. */
const seededPlaygroundSessions = new Set<string>();
let demoProfileSeeded = false;


const NATIVE_GUEST_CHECKOUT_POST_PATH =
  /^\/_emdash\/api\/plugins\/dinkus-commerce\/checkout\/guest\/(prepare|start|status)$/;

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
  const isCloudflare =
    process.env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    process.env.ASTRO_ADAPTER === "cloudflare" ||
    Boolean((context.locals as { runtime?: unknown }).runtime);

  const isProofMode =
    process.env.DINKUS_STOREFRONT_PROFILE === "proof" ||
    process.env.DINKUS_PROOF_MODE === "1";
  const isPlayground =
    Boolean((context.locals as { __playgroundDb?: unknown }).__playgroundDb);

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
  }

  if (isPlayground) {
    // EmDash seeds CMS content into each per-visitor DB; Commerce items live in
    // plugin storage, so create the synthetic demo catalog once per session.
    const session = context.cookies.get("emdash_playground")?.value;
    if (session && !seededPlaygroundSessions.has(session)) {
      const db = (context.locals as { __playgroundDb: Parameters<typeof ensurePlaygroundDemoCatalog>[0] }).__playgroundDb;
      await ensurePlaygroundDemoCatalog(db);
      seededPlaygroundSessions.add(session);
    }
  } else if (isDemoCatalogProfile() && !demoProfileSeeded) {
    // The demo profile (native-development catalog + proof storefront) gets the
    // same create-only-if-missing demo catalog. Shipping stores never do.
    demoProfileSeeded = true;
    const { getDb } = await import("emdash/runtime");
    await ensurePlaygroundDemoCatalog(await getDb() as Parameters<typeof ensurePlaygroundDemoCatalog>[0])
      .catch((error: unknown) => { demoProfileSeeded = false; console.error("[demo-seed] failed", error); });
  }

  // Sandbox checkout opens ONLY for a playground session with the flag on and
  // every Payments value present; the request has already passed body
  // validation, the visitor-IP check and the limiter above. Registry-path calls
  // from the cart are served by the playground's native Commerce routes.
  if (checkoutKind && isPlayground && playgroundCheckoutConfigured()) {
    const clientIp = visitorIp(context.request);
    if (!clientIp && checkoutKind === "start") {
      const refused = checkoutJsonError(400, SANDBOX_CLIENT_IP_MESSAGE);
      applySecurityHeaders(refused.headers);
      return refused;
    }
    const response = await withCheckoutVisitor(clientIp ?? "", () => next(nativeCheckoutPath(checkoutKind)));
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

    const response = await next();
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

  const response = await next();
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

async function boundedCheckoutBody(request: Request): Promise<string | null> {
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
        await reader.cancel();
        return null;
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
