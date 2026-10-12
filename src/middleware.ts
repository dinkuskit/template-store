import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  decodedForms,
  evaluatePublicBoundary,
  isExactGuestCheckoutPath,
} from "./features/security/public-boundary.js";
import { resolveGuestCheckoutAdmission } from "./features/guest-cart/checkout-admission.js";
import { ensurePlaygroundDemoCatalog } from "./features/playground/demo-commerce-seed.js";
import { isDemoCatalogProfile } from "./features/playground/demo-products.js";

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

    if (isExactGuestCheckoutPath(url.pathname) &&
        !resolveGuestCheckoutAdmission({
          runtime: context.locals.emdash,
          // Core has not supplied the same-namespace catalog/config authority.
          catalog: null,
        })) {
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

    const response = await next();
    applySecurityHeaders(response.headers);
    return response;
  }

  if (isExactGuestCheckoutPath(context.url.pathname) &&
      !resolveGuestCheckoutAdmission({
        runtime: context.locals.emdash,
        catalog: null,
      })) {
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
