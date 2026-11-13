import type { APIRoute } from "astro";
import {
  buildAgentCatalogFeed,
  buildInstalledStorefrontAgentFeedOptions,
} from "../../features/commerce-feeds/index.js";

/**
 * The store's product catalog as JSON, for programs: the DinkusKit cross-store
 * catalog reads it, and so may every agent. It carries only what a shopper can
 * already see on the store (GrillTrack `agent-catalog-data-20261113`, dinkuskit).
 */
export const GET: APIRoute = async ({ locals, request, site }) => {
  try {
    const options = await buildInstalledStorefrontAgentFeedOptions({
      runtime: locals.emdash,
      request,
      site,
    });
    return new Response(JSON.stringify(buildAgentCatalogFeed(options)), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Catalog feed unavailable until the installed Commerce public catalog is available." }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
    );
  }
};
