import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";

import { readInstalledCommerceProduct, type InstalledCatalogContext } from "../commerce-catalog/installed.js";
import { productPath } from "../store-shell/merch-catalog.js";
import { wantsJson } from "./server-cart.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /variants/<id>: Shopify's variant link. Commerce knows which page sells a product (by the page's entry id),
 * not the page's address, so this finds that published page and sends the shopper there, on the variant when the
 * id is one. Asked for JSON (the show_variant agent tool), it answers `{ ok, url }` instead of redirecting.
 */
export const getVariant: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const asJson = wantsJson(context.request, context.url);
  const notFound = () => asJson
    ? Response.json({ ok: false, error: { code: "NOT_FOUND", message: "No published product page sells that item." } }, { status: 404, headers: NO_STORE })
    : new Response("Not found", { status: 404, headers: NO_STORE });
  if (!SAFE_ID.test(id)) return notFound();
  let product: Awaited<ReturnType<typeof readInstalledCommerceProduct>>;
  try {
    product = await readInstalledCommerceProduct(id, {
      runtime: context.locals.emdash as InstalledCatalogContext["runtime"],
      request: context.request,
    });
  } catch {
    return asJson
      ? Response.json({ ok: false, error: { code: "UNAVAILABLE", message: "The catalog could not be read. Try again." } }, { status: 503, headers: NO_STORE })
      : new Response("Unavailable", { status: 503, headers: NO_STORE });
  }
  if (!product?.page) return notFound();
  const pages = await getEmDashCollection<"products", Record<string, unknown>>("products", { status: "published" });
  const page = pages.entries.find((entry) => entry.data.id === product.page);
  const path = page ? productPath(page.id) : null;
  if (!path) return notFound();
  const variant = product.variants?.some((member) => member.id === id) ? `?variant=${encodeURIComponent(id)}` : "";
  const url = `${path}${variant}`;
  return asJson
    ? Response.json({ ok: true, url }, { headers: NO_STORE })
    : new Response(null, { status: 302, headers: { location: url, ...NO_STORE } });
};
