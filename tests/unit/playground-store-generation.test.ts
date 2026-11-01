/**
 * A visitor store the playground made before it ran Commerce's Registry build starts over on its next request
 * (playground-commerce-in-store-20261031; Ronald, 1 Nov 2026: a fresh store, as if its hour had run out), instead of
 * showing a fresh demo shop over Commerce data the Registry build cannot see. Stores made since are seeded as usual.
 */
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
const ensurePlaygroundDemoCatalog = vi.fn(async () => ({ created: [], connected: true }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({ ensurePlaygroundDemoCatalog }));

const { onRequest } = await import("../../src/middleware.js");
const { madeBeforeRegistryCommerce, restartPlaygroundStore } = await import("../../src/features/playground/store-generation.js");

let db: Kysely<never>;
beforeEach(async () => {
  db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
  await runMigrations(db as never);
  ensurePlaygroundDemoCatalog.mockClear();
});
afterEach(async () => { await db.destroy(); });

const now = new Date().toISOString();
async function store(pluginId: string, collection: string) {
  await (db as unknown as Kysely<Record<string, Record<string, unknown>>>).insertInto("_plugin_storage")
    .values({ plugin_id: pluginId, collection, id: "item-1", data: JSON.stringify({ sku: "OLD" }), created_at: now, updated_at: now })
    .execute();
}

async function request(method: string, path = "/", session = `pg-${crypto.randomUUID()}`) {
  const req = new Request(`https://playground.example${path}`, { method, headers: { cookie: `emdash_playground=${session}` } });
  const locals: Record<string, unknown> = { emdash: { handlePluginApiRoute: vi.fn() }, __playgroundDb: db };
  const next = vi.fn(async () => new Response("store", { status: 200 }));
  const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)({
    url: new URL(req.url), request: req, locals, cookies: { get: (name: string) => (name === "emdash_playground" ? { value: session } : undefined) },
  }, next);
  return { response, next };
}

describe("playground stores from before the Registry build", () => {
  it("tells a store made by the native-Commerce playground from one made since", async () => {
    expect(await madeBeforeRegistryCommerce(db as never)).toBe(false);
    await store("r_gshdrqaldna3r7sn", "catalog_items");
    expect(await madeBeforeRegistryCommerce(db as never)).toBe(false);
    await store("dinkus-commerce", "catalogItems");
    expect(await madeBeforeRegistryCommerce(db as never)).toBe(true);
  });

  it("starts such a store over: a page load goes back to /playground, anything else is told to reload", async () => {
    await store("dinkus-commerce", "catalogItems");
    const page = await request("GET");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("location")).toBe("/playground");
    expect(page.response.headers.get("set-cookie")).toMatch(/^emdash_playground=; Max-Age=0/);
    expect(page.next).not.toHaveBeenCalled();
    const api = await request("POST", "/_emdash/api/plugins/r_gshdrqaldna3r7sn/admin");
    expect(api.response.status).toBe(409);
    expect(await api.response.json()).toMatchObject({ error: { code: "PLAYGROUND_RESTARTED" } });
    expect(api.response.headers.get("set-cookie")).toMatch(/^emdash_playground=; Max-Age=0/);
    expect(ensurePlaygroundDemoCatalog).not.toHaveBeenCalled();
    expect(restartPlaygroundStore(new Request("https://playground.example/", { method: "HEAD" })).status).toBe(302);
  });

  it("seeds a store made since as usual", async () => {
    const { response, next } = await request("GET");
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(ensurePlaygroundDemoCatalog).toHaveBeenCalledOnce();
  });
});
