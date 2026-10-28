import { OptionsRepository, invalidateSchemaObjectCache } from "emdash";
import { ensureStorefrontPageAddresses, ensureStorefrontProductFields } from "./product-schema-upgrade.ts";
import { ensureStorefrontSearchSupport } from "./search-upgrade.ts";

/** The EmDash option that lists the storefront upgrades a store has run (template-store-self-upgrade-20261028). */
export const STOREFRONT_UPGRADES_OPTION = "dinkus:storefront-upgrades";

export interface StorefrontUpgrade {
  readonly name: string;
  readonly run: (db: unknown) => Promise<void>;
}

/**
 * The schema changes newer templates make to a store set up from an older seed,
 * oldest first, the way EmDash lists its own migrations. Each step only adds or
 * relaxes, keeps owner edits and is safe to run twice. A template change to the
 * schema in seed/seed.json adds its step here in the same change; a step's name
 * never changes once shipped.
 */
export const STOREFRONT_UPGRADES: readonly StorefrontUpgrade[] = [
  { name: "001_storefront_search", run: ensureStorefrontSearchSupport },
  { name: "002_product_fields", run: ensureStorefrontProductFields },
  { name: "003_page_addresses", run: ensureStorefrontPageAddresses },
];

function recordedNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

/**
 * Runs, in order, each storefront upgrade the store has not recorded, recording
 * each one as it succeeds, and returns the names it ran. A failed step stops the
 * run unrecorded, so the next run starts again from it. `all` reruns every step,
 * as `pnpm search:upgrade` does to repair a local database.
 */
export async function upgradeStorefront(
  db: unknown,
  { all = false, upgrades = STOREFRONT_UPGRADES }: { all?: boolean; upgrades?: readonly StorefrontUpgrade[] } = {},
): Promise<string[]> {
  const options = new OptionsRepository(db as never);
  const recorded = new Set(recordedNames(await options.get(STOREFRONT_UPGRADES_OPTION)));
  const ran: string[] = [];
  try {
    for (const upgrade of upgrades) {
      if (!all && recorded.has(upgrade.name)) continue;
      await upgrade.run(db);
      ran.push(upgrade.name);
      recorded.add(upgrade.name);
      await options.set(STOREFRONT_UPGRADES_OPTION, [...recorded]);
    }
  } finally {
    // Schema reads may be cached across requests; a changed schema starts them afresh.
    if (ran.length > 0) invalidateSchemaObjectCache();
  }
  return ran;
}

/**
 * Brings the store up to the template's schema on the first request this isolate
 * serves, after EmDash's own migrations, the way EmDash runs those. It follows
 * EMDASH_MIGRATIONS_MODE: "manual" or "check" leaves the store as it is. A
 * failure is logged and tried again after `retryMs`; it never fails the request.
 */
export function storefrontUpgrader(retryMs = 60_000) {
  let done = false;
  let running: Promise<void> | undefined;
  let retryAt = 0;
  return async (db: () => Promise<unknown>, { mode, now = Date.now() }: { mode?: string; now?: number } = {}): Promise<void> => {
    if (done || (mode ?? "auto") !== "auto" || now < retryAt) return;
    running ??= (async () => {
      try {
        const ran = await upgradeStorefront(await db());
        if (ran.length > 0) console.info("[storefront-upgrade] ran", ran.join(", "));
        done = true;
      } catch (error) {
        retryAt = now + retryMs;
        console.error("[storefront-upgrade] the store's schema was not upgraded; trying again later:", error);
      } finally {
        running = undefined;
      }
    })();
    await running;
  };
}
