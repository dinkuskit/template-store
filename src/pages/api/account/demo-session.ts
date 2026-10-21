import type { APIRoute } from "astro";
import { isDemoCatalogProfile } from "../../../features/playground/demo-products.js";
import { mintDemoShopperSession } from "../../../features/shopper-account/playground-runtime.js";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  const isPlayground = Boolean((locals as { __playgroundDb?: unknown }).__playgroundDb);
  if (!isPlayground && !isDemoCatalogProfile()) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Route not found." } }),
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  const originHeader = request.headers.get("origin")?.trim() ?? "";
  if (!originHeader || originHeader !== url.origin) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }),
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  try {
    let db = (locals as { __playgroundDb?: Parameters<typeof mintDemoShopperSession>[0] }).__playgroundDb;
    if (!db) {
      const { getDb } = await import("emdash/runtime");
      db = (await getDb()) as Parameters<typeof mintDemoShopperSession>[0];
    }
    const minted = await mintDemoShopperSession(db, url.origin);
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
  if (!isPlayground && !isDemoCatalogProfile()) {
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
