import type { APIRoute } from "astro";
import { checkoutLimited } from "../../../features/playground-checkout/index.js";
import {
  mintDemoShopperSession,
  resolvePlaygroundAccountSiteOrigin,
} from "../../../features/shopper-account/playground-runtime.js";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  // The instant demo shopper is the playground's; a store running Commerce's Registry build has none.
  const isPlayground = Boolean((locals as { __playgroundDb?: unknown }).__playgroundDb);
  if (!isPlayground) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Route not found." } }),
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  const playgroundEnv =
    (locals as { __playgroundEnv?: Record<string, unknown> }).__playgroundEnv ??
    (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv ??
    process.env;
  const trustedOrigin = resolvePlaygroundAccountSiteOrigin(playgroundEnv);
  if (!trustedOrigin) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "UNAVAILABLE", message: "Could not start the demo shopper session." },
      }),
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const originHeader = request.headers.get("origin")?.trim() ?? "";
  if (!originHeader || originHeader !== trustedOrigin || url.origin !== trustedOrigin) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }),
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  if (isPlayground) {
    const limiter = (locals as { __playgroundCheckoutLimiter?: unknown }).__playgroundCheckoutLimiter;
    if (limiter && (await checkoutLimited(request, limiter))) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many demo account requests from this connection. Please wait a few minutes and try again.",
          },
        }),
        { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": "60" } },
      );
    }
  }
  try {
    let db = (locals as { __playgroundDb?: Parameters<typeof mintDemoShopperSession>[0] }).__playgroundDb;
    if (!db) {
      const { getDb } = await import("emdash/runtime");
      db = (await getDb()) as Parameters<typeof mintDemoShopperSession>[0];
    }
    const minted = await mintDemoShopperSession(db, trustedOrigin, playgroundEnv);
    return new Response(JSON.stringify(minted), { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "UNAVAILABLE", message: "Could not start the demo shopper session." },
      }),
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
};

export const ALL: APIRoute = async ({ locals }) => {
  const isPlayground = Boolean((locals as { __playgroundDb?: unknown }).__playgroundDb);
  if (!isPlayground) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Route not found." } }),
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return new Response(
    JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }),
    { status: 405, headers: NO_STORE_HEADERS },
  );
};
