import type { PluginStorageRepository } from "emdash";
import { CLEAR_PLAYGROUND_COOKIE } from "./contract.js";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];

/** The plugin id the playground's native Commerce kept its data under, before the Registry build. */
const NATIVE_COMMERCE_PLUGIN_ID = "dinkus-commerce";

/**
 * Whether this visitor store was made by the playground before it ran Commerce's Registry build
 * (playground-commerce-in-store-20261031). Its Commerce data sits under the native plugin id, which the Registry
 * build cannot see, so its edits, orders, sign-ins and checkout would vanish behind a fresh demo shop. Such a store
 * starts over instead, as if its hour had run out (Ronald, 1 Nov 2026). Nothing writes under that id now.
 */
export async function madeBeforeRegistryCommerce(db: Db): Promise<boolean> {
  const row = await (db as unknown as {
    selectFrom(table: "_plugin_storage"): {
      select(column: "id"): {
        where(column: "plugin_id", op: "=", value: string): {
          limit(count: number): { executeTakeFirst(): Promise<unknown> };
        };
      };
    };
  }).selectFrom("_plugin_storage").select("id").where("plugin_id", "=", NATIVE_COMMERCE_PLUGIN_ID).limit(1).executeTakeFirst();
  return row !== undefined;
}

/**
 * Starts a visitor over on a fresh store: a page load goes back to /playground without the old session, which mints
 * a new store; every other request is told to reload. Either way the old session cookie is cleared.
 */
export function restartPlaygroundStore(request: Request): Response {
  const headers = { "Set-Cookie": CLEAR_PLAYGROUND_COOKIE, "Cache-Control": "no-store" };
  if (request.method === "GET" || request.method === "HEAD") {
    return new Response(null, { status: 302, headers: { ...headers, Location: "/playground" } });
  }
  return Response.json(
    { success: false, error: { code: "PLAYGROUND_RESTARTED", message: "The playground has been updated. Reload the page to start a fresh store." } },
    { status: 409, headers },
  );
}
