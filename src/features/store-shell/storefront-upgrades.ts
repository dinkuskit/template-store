import { OptionsRepository, invalidateSchemaObjectCache } from "emdash";
import { ensureStorefrontCategoryProducts, ensureStorefrontPageAddresses, ensureStorefrontProductFields, removeStorefrontCommerceBox } from "./product-schema-upgrade.ts";
import { ensureStorefrontSearchSupport } from "./search-upgrade.ts";

/** The EmDash option that lists the storefront upgrades a store has run (template-store-self-upgrade-20261028). */
export const STOREFRONT_UPGRADES_OPTION = "dinkus:storefront-upgrades";

export interface StorefrontUpgrade {
  readonly name: string;
  /** "wait" leaves the step unrecorded, to be tried again later, without holding back the steps after it. */
  readonly run: (db: unknown) => Promise<void | "wait">;
}

/**
 * The schema changes newer templates make to a store set up from an older seed,
 * oldest first, the way EmDash lists its own migrations. Each step only adds or
 * relaxes, keeps owner edits and is safe to run twice. The one exception is
 * 005, which removes the Commerce product field only once no page, draft or
 * trashed page included, needs it (template-no-commerce-box-20261029). A template change to the schema in
 * seed/seed.json adds its step here in the same change; a step's name never
 * changes once shipped.
 */
export const STOREFRONT_UPGRADES: readonly StorefrontUpgrade[] = [
  { name: "001_storefront_search", run: ensureStorefrontSearchSupport },
  { name: "002_product_fields", run: ensureStorefrontProductFields },
  { name: "003_page_addresses", run: ensureStorefrontPageAddresses },
  { name: "004_category_products", run: ensureStorefrontCategoryProducts },
  { name: "005_commerce_box_off", run: removeStorefrontCommerceBox },
];

function recordedNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

/**
 * Runs, in order, each storefront upgrade the store has not recorded, recording
 * each one as it succeeds, and returns the names it ran. A failed step stops the
 * run unrecorded, so the next run starts again from it. A step that answers
 * "wait" stays unrecorded, is added to `waiting`, and the run goes on. `all`
 * reruns every step, as `pnpm search:upgrade` does to repair a local database.
 */
export async function upgradeStorefront(
  db: unknown,
  { all = false, upgrades = STOREFRONT_UPGRADES, waiting = [] }: { all?: boolean; upgrades?: readonly StorefrontUpgrade[]; waiting?: string[] } = {},
): Promise<string[]> {
  const options = new OptionsRepository(db as never);
  const recorded = new Set(recordedNames(await options.get(STOREFRONT_UPGRADES_OPTION)));
  const ran: string[] = [];
  try {
    for (const upgrade of upgrades) {
      if (!all && recorded.has(upgrade.name)) continue;
      if ((await upgrade.run(db)) === "wait") {
        waiting.push(upgrade.name);
        continue;
      }
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
 * Whether EmDash has finished seeding the store or the owner has finished setting
 * it up. EmDash seeds a store that has neither on its first request, so until then
 * there is nothing to upgrade, and a seed still being written isn't touched.
 */
export async function storeIsSetUp(db: unknown): Promise<boolean> {
  const options = await new OptionsRepository(db as never).getMany(["emdash:seed_complete", "emdash:setup_complete"]);
  return options.get("emdash:seed_complete") === true || options.get("emdash:setup_complete") === true;
}

/**
 * Brings the store up to the template's schema on the first request this isolate
 * serves, after EmDash's own migrations and first seed, the way EmDash runs those.
 * It follows EMDASH_MIGRATIONS_MODE: "manual" or "check" leaves the store as it is.
 * A store not yet seeded or set up, or a failure, is tried again after `retryMs`; a
 * failure is logged and never fails the request. A step that is waiting is tried
 * again after `waitMs`.
 */
export function storefrontUpgrader(retryMs = 60_000, waitMs = 15 * 60_000) {
  let done = false;
  let running: Promise<void> | undefined;
  let retryAt = 0;
  return async (db: () => Promise<unknown>, { mode, now = Date.now() }: { mode?: string; now?: number } = {}): Promise<void> => {
    if (done || (mode ?? "auto") !== "auto" || now < retryAt) return;
    running ??= (async () => {
      try {
        const store = await db();
        if (!(await storeIsSetUp(store))) {
          retryAt = now + retryMs;
          return;
        }
        const waiting: string[] = [];
        const ran = await upgradeStorefront(store, { waiting });
        if (ran.length > 0) console.info("[storefront-upgrade] ran", ran.join(", "));
        if (waiting.length > 0) retryAt = now + waitMs;
        else done = true;
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
