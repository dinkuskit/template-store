import type { APIRoute } from "astro";
import {
  buildInstalledStorefrontAgentFeedOptions,
  buildStorefrontAgentsMd,
} from "../features/commerce-feeds/index.js";

export const GET: APIRoute = async ({ locals, request, site }) => {
  try {
    const options = await buildInstalledStorefrontAgentFeedOptions({
      runtime: locals.emdash,
      request,
      site,
    });
    return new Response(buildStorefrontAgentsMd(options), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response(
      "Storefront agents.md unavailable until the installed Commerce public catalog is available.",
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
};
