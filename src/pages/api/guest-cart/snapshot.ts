import type { APIRoute } from "astro";

import { readCommerceCatalogSnapshots } from "../../../features/commerce-catalog/index.js";
import { parseGuestCartSnapshotIds, projectGuestCartCatalogSnapshots } from "../../../features/guest-cart/index.js";

export const prerender = false;

function snapshotJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ url, locals, request }) => {
  const ids = parseGuestCartSnapshotIds(url.searchParams.get("ids"));
  if (ids === null) {
    return snapshotJson({ error: "invalid_ids" }, 400);
  }
  try {
    const products = projectGuestCartCatalogSnapshots(await readCommerceCatalogSnapshots(ids, { runtime: locals.emdash, request }));
    if (products === null) {
      return snapshotJson(
        {
          error: "catalog_unavailable",
          message: "Current product details could not be loaded. Your cart was kept.",
        },
        503,
      );
    }
    return snapshotJson({ products });
  } catch {
    return snapshotJson(
      {
        error: "catalog_unavailable",
        message: "Current product details could not be loaded. Your cart was kept.",
      },
      503,
    );
  }
};
