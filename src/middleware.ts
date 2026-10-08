import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  decodedForms,
  evaluatePublicBoundary,
  slashlessRedirectPath,
} from "./features/security/public-boundary.js";

const LEGACY_GUEST_CHECKOUT_POST_PATH =
  /^\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/(prepare|start|status)$/;

export const onRequest = defineMiddleware(async (context, next) => {
  let pathForms: string[];
  try {
    pathForms = decodedForms(context.url.pathname);
  } catch {
    const response = Response.json({ error: "Invalid path." }, { status: 403 });
    applySecurityHeaders(response.headers);
    return response;
  }
  const slashlessPath = slashlessRedirectPath(context.url.pathname);
  if (slashlessPath && (context.request.method === "GET" || context.request.method === "HEAD")) {
    const redirectUrl = new URL(context.request.url);
    redirectUrl.pathname = slashlessPath;
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.href,
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

  if (isCloudflare && !isProofMode) {
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

    const response = await next();
    applySecurityHeaders(response.headers);
    return response;
  }

  if (pathForms.some((path) => LEGACY_GUEST_CHECKOUT_POST_PATH.test(path))) {
    const response = new Response(
      JSON.stringify({ error: "Legacy source-alias checkout is not a supported install." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    );
    applySecurityHeaders(response.headers);
    return response;
  }

  return next();
});
