import type { APIRoute } from "astro";
import { buildMetaCatalogFeed, buildInstalledCommerceFeedFacts } from "../../features/commerce-feeds/index.js";

export const GET: APIRoute = async ({ locals, request, site }) => {
  try {
    const facts = await buildInstalledCommerceFeedFacts({
      runtime: locals.emdash,
      request,
      site,
    });
    return new Response(buildMetaCatalogFeed(facts), {
      headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("Feed unavailable until the installed Commerce public catalog is available.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
};
