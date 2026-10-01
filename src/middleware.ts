import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  evaluatePublicBoundary,
} from "./features/security/public-boundary.js";

export const onRequest = defineMiddleware(async (context, next) => {
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

  return next();
});
