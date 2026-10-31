/**
 * The demo catalog on a store that runs Commerce's Registry build (template-one-build-registry-20261031):
 * the hosted demo, pnpm dev:fresh and the proof store the browser tests use. Everything goes through the
 * installed plugin's own private routes, as the owner's product panel and the CLI do (catalog-api-20261027),
 * so the seed proves the Registry build and opens no plugin storage itself: each demo product's page first,
 * then the product created for that page, its choices, its prices and stock status, and the sale the page's
 * publish would record. Create-only-if-missing, keyed by SKU; nothing here resets a product someone edited.
 */
import { applySeed, type SeedFile } from "emdash/seed";
import { sql } from "kysely";

import {
  DEMO_PRODUCTS,
  demoAvailabilityForSku,
  demoRegularMinorForSku,
  demoVariantOptionInput,
  type DemoProductSeed,
} from "../../../scripts/demo-seed-policy.js";
import { ensureStorefrontSearchSupport } from "../store-shell/index.js";
import { buildDemoProductEntries, demoProductKind } from "./demo-products.js";

type RouteResult = { success: boolean; data?: unknown; error?: { code?: string; message?: string } };
export interface CommerceSeedRuntime {
  handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, user?: unknown): Promise<RouteResult>;
  getPluginRouteMeta(pluginId: string, path: string): unknown;
  db?: unknown;
}

/** The seed's clerk, an Administrator, as EmDash hands a signed-in person to a private plugin route. */
export const DEMO_SEED_CLERK = Object.freeze({
  id: "dinkus-demo-seed",
  email: "demo-seed@dinkuskit.invalid",
  name: "Demo seed",
  role: 50,
  createdAt: "2026-10-31T00:00:00.000Z",
});

const CATALOG_ROUTE = "catalog";
const SET_ON_SALE_ROUTE = "catalog-items/set-on-sale";
/** The product panel's stock status for a demo item's storefront availability. */
const STOCK_STATUS: Record<string, string> = {
  "in-stock": "in-stock",
  "out-of-stock": "out-of-stock",
  "available-on-backorder": "on-backorder",
};

/** Cents as the product panel's dollars field takes them: "3200" is "32.00". */
export function dollars(minor: string): string {
  const cents = minor.padStart(3, "0");
  return `${cents.slice(0, -2)}.${cents.slice(-2)}`;
}

interface VariantMember { catalogItemId: string; selections: { optionId: string; valueId: string }[] }
interface VariantProduct { revision: number; members: VariantMember[] }

export class DemoSeedRefusal extends Error {
  constructor(readonly route: string, readonly code: string, message: string) {
    super(`Commerce ${route} refused: ${code} ${message}`.trim());
  }
}

async function call<T>(runtime: CommerceSeedRuntime, pluginId: string, origin: string, path: string, body: Record<string, unknown>): Promise<T> {
  const request = new Request(new URL(`/_emdash/api/plugins/${pluginId}/${path}`, origin), {
    method: "POST",
    headers: { "content-type": "application/json", "X-EmDash-Request": "1" },
    body: JSON.stringify(body),
  });
  const result = await runtime.handlePluginApiRoute(pluginId, "POST", path, request, DEMO_SEED_CLERK);
  if (!result.success) {
    throw new DemoSeedRefusal(`${path}${typeof body.op === "string" ? ` ${body.op}` : ""}`, result.error?.code ?? "UNKNOWN", result.error?.message ?? "");
  }
  return result.data as T;
}

/**
 * The demo member a Commerce member is, by its option values. While later choices are still to be added,
 * a member stands for the demo member that takes the first value of each of them (as demoVariantOptionInput
 * builds the choices).
 */
function memberSku(product: DemoProductSeed, member: VariantMember): string {
  const options = product.variant?.options ?? [];
  const chosen = new Map(member.selections.map((selection) => [selection.optionId, selection.valueId]));
  const match = product.variant?.members.find((candidate) =>
    options.every((option) => candidate.selections[option.optionId] === (chosen.get(option.optionId) ?? option.values[0]?.valueId)));
  return match?.sku ?? product.sku;
}

async function createProduct(runtime: CommerceSeedRuntime, pluginId: string, origin: string, product: DemoProductSeed, entryId: string): Promise<void> {
  const op = <T>(body: Record<string, unknown>) => call<T>(runtime, pluginId, origin, CATALOG_ROUTE, body);
  const { catalogItemId } = await op<{ catalogItemId: string }>({ op: "create", commandId: product.commandId, name: product.name, sku: product.sku, entryId });
  const items = new Map<string, string>([[catalogItemId, product.sku]]);
  if (product.variant) {
    // Commerce adds one choice at a time; each later choice names the revision it read.
    let variant: VariantProduct | undefined;
    for (const [index] of product.variant.options.entries()) {
      const existing = new Map<string, string>();
      for (const member of variant?.members ?? []) {
        if (member.catalogItemId !== catalogItemId) existing.set(memberSku(product, member).toUpperCase(), member.catalogItemId);
      }
      const input = demoVariantOptionInput(product, index, catalogItemId, existing, index === 0 ? undefined : variant?.revision);
      variant = (await op<{ product: VariantProduct }>({ op: "choice", ...input })).product;
    }
    for (const member of variant?.members ?? []) items.set(member.catalogItemId, memberSku(product, member));
  }
  for (const [itemId, sku] of items) {
    await op({
      op: "prices",
      catalogItemId: itemId,
      regular: dollars(demoRegularMinorForSku(product, sku)),
      sale: product.saleMinor === null ? "" : dollars(product.saleMinor),
      stockStatus: STOCK_STATUS[demoAvailabilityForSku(product, sku)] ?? "in-stock",
    });
  }
  // The page is published, so its product is on sale, as the store's publish check records it.
  await call(runtime, pluginId, origin, SET_ON_SALE_ROUTE, { entryId, onSale: true });
}

/** Each demo product's page slug (`demo-<kind>`), as the seed publishes it. */
export function demoPageSlug(product: Pick<DemoProductSeed, "sku" | "variant">): string {
  return `demo-${demoProductKind(product)}`;
}

/**
 * Creates the demo product pages and the Commerce products missing for them, through the installed
 * Commerce under `pluginId` (its Registry runtime id). Existing SKUs and pages are left untouched.
 */
export async function ensureDemoCatalogThroughCommerce(
  runtime: CommerceSeedRuntime,
  pluginId: string,
  origin: string,
): Promise<{ created: string[] }> {
  if (!runtime.getPluginRouteMeta(pluginId, CATALOG_ROUTE)) {
    throw new Error(`Commerce ${pluginId} declares no ${CATALOG_ROUTE} route; is the Registry build installed?`);
  }
  const db = runtime.db as Parameters<typeof applySeed>[0] | undefined;
  if (!db) throw new Error("EmDash runtime has no database for the demo seed");
  // Pages first, known by their slugs; Commerce links each product to its page (template-no-commerce-box-20261029).
  const entries = buildDemoProductEntries(DEMO_PRODUCTS.map((product) => ({ sku: product.sku, catalogItemId: "pending" })));
  await applySeed(db, { version: "1", content: { products: entries } } as SeedFile, {
    includeContent: true, onConflict: "skip", skipMediaDownload: true,
  });
  const rows = await sql<{ id: string; slug: string }>`
    select id, slug from ec_products
    where slug in (${sql.join(entries.map((entry) => entry.slug))}) and status = 'published' and deleted_at is null`.execute(db as never);
  const pages = new Map(rows.rows.map((row) => [row.slug, row.id]));
  const listed = await call<{ products: { catalogItemId: string; sku: string }[] }>(runtime, pluginId, origin, CATALOG_ROUTE, { op: "list" });
  const existing = new Set(listed.products.map((product) => product.sku.toUpperCase()));
  const created: string[] = [];
  for (const product of DEMO_PRODUCTS) {
    if (existing.has(product.sku.toUpperCase())) continue;
    const entryId = pages.get(demoPageSlug(product));
    if (!entryId) throw new Error(`The demo page ${demoPageSlug(product)} is not published, so ${product.sku} has no page to sell from`);
    await createProduct(runtime, pluginId, origin, product, entryId);
    created.push(product.sku);
  }
  await ensureStorefrontSearchSupport(db as never);
  return { created };
}
