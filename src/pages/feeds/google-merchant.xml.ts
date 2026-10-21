import type { APIRoute } from "astro";
import { buildGoogleMerchantFeed, buildInstalledCommerceFeedFacts } from "../../features/commerce-feeds/index.js";

export const GET: APIRoute = async ({ locals, request, site }) => {
  try {
    const facts = await buildInstalledCommerceFeedFacts({
      runtime: locals.emdash,
      request,
      site,
    });
    return new Response(buildGoogleMerchantFeed(facts), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("Feed unavailable until the installed Commerce public catalog is available.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
};
