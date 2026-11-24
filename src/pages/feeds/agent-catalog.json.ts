import type { APIRoute } from "astro";
import { buildInstalledAgentCatalogFeed } from "../../features/commerce-feeds/index.js";

/**
 * The store's product catalog as JSON, for programs: the DinkusKit cross-store
 * catalog reads it, and so may every agent. It carries only what a shopper can
 * already see on the store (GrillTrack `agent-catalog-data-20261113`, dinkuskit).
 * It lists every product on sale with a published page; the Google and Meta feed boxes
 * do not apply here (GrillTrack `template-agent-feed-lists-all-20261122`).
 * While the owner has "List my products in the DinkusKit catalog" off in Commerce
 * settings the feed lists no products, so the catalog drops the store.
 */
export const GET: APIRoute = async ({ locals, request, site }) => {
  try {
    const feed = await buildInstalledAgentCatalogFeed({ runtime: locals.emdash, request, site });
    return new Response(JSON.stringify(feed), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Catalog feed unavailable until the installed Commerce public catalog is available." }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
    );
  }
};
