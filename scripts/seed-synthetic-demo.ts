/**
 * Operator seeder for the synthetic hosted demo.
 *
 * Local writes use Wrangler's getPlatformProxy D1 binding with remoteBindings
 * false. Remote writes are opt-in and fail closed before any proxy unless the
 * ignored operator target matches. This file does not open SQLite paths.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDialect } from "@emdash-cms/cloudflare/db/d1";
import {
  clearCatalogItemSalePrice,
  addCatalogVariantOption,
  createCatalogItem,
  createPlugin,
  listCatalogProducts,
  setCatalogItemManualAvailability,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
  saveCatalogItemMedia,
  CATALOG_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_MEDIA_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  COMMERCE_PLUGIN_ID,
  type CatalogManualAvailabilityRecord,
  type CatalogMediaRecord,
  type CatalogPriceRecord,
  type CatalogStorageRecord,
} from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { applySeed, validateSeed, type SeedFile } from "emdash/seed";
import { getPlatformProxy } from "wrangler";

import {
  assertCommerceSkuIndexPresent,
  assertInvocationAllowed,
  assertLocalConfig,
  assertProductionConfig,
  assertRemoteOperatorTarget,
  COMMERCE_SKU_UNIQUE_INDEX,
  DEFAULT_PERSIST_PATH,
  DEMO_D1_BINDING,
  DEMO_PRODUCTS,
  isDemoSku,
  LOCAL_CONFIG_PATH,
  LOCAL_ID_PATH,
  parseRemoteTargetManifest,
  parseWranglerConfig,
  PRODUCTION_CONFIG_PATH,
  REMOTE_CONFIG_PATH,
  REMOTE_TARGET_MANIFEST_PATH,
  SeedRefusal,
  type DemoProductSeed,
} from "./demo-seed-policy.js";
import { buildDemoProductEntries, type DemoCatalogLink } from "./demo-product-entries.js";

const PLATFORM_ENV = Symbol.for("dinkus.localPlatformEnv");
const SENTINEL = Object.freeze({
  commandId: "seed-sentinel-keep",
  name: "Sentinel Keep",
  sku: "SENTINEL-KEEP",
  regularMinor: "1111",
  saleMinor: null,
  availability: "in-stock" as const,
});

const LEGACY_SCHEMA_SEED: SeedFile = {
  version: "1",
  collections: [{
    slug: "merchandise",
    label: "Legacy merchandise",
    labelSingular: "Legacy merchandise item",
    fields: [{ slug: "title", label: "Title", type: "string", required: true }],
  }],
};

type EmDashDb = Parameters<typeof runMigrations>[0];
type SqlQuery<T> = { execute(db: EmDashDb): Promise<{ rows: T[] }> };

interface KyselyModule {
  Kysely: new (config: { dialect: ReturnType<typeof createDialect> }) => EmDashDb;
  sql: <T>(strings: TemplateStringsArray, ...values: readonly unknown[]) => SqlQuery<T>;
}

interface StorageDeclaration {
  indexes?: Array<string | string[]>;
  uniqueIndexes?: Array<string | string[]>;
}

interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  all(): Promise<{ results?: Array<{ name?: unknown }> }>;
}

/** prepare/batch subset of the Workers D1Database binding. The rest is not claimed. */
interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementBinding;
  batch(statements: readonly D1PreparedStatementBinding[]): Promise<unknown>;
}

function isD1DatabaseBinding(value: unknown): value is D1DatabaseBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    typeof value.prepare === "function" &&
    "batch" in value &&
    typeof value.batch === "function"
  );
}

interface CatalogRow {
  catalogItemId: string;
  name: string;
  sku: string;
  regular: string | null;
  sale: string | null;
  stockStatus: string | null;
}

function repoRoot(): string {
  return process.cwd();
}

function parseJsonc(text: string): unknown {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function readConfig(path: string): unknown {
  return parseJsonc(readFileSync(path, "utf8"));
}

function emdashPackagePath(): string {
  return realpathSync(resolve(repoRoot(), "node_modules/emdash/package.json"));
}

function kyselyFromEmDash(): KyselyModule {
  const loaded: unknown = createRequire(emdashPackagePath())("kysely");
  if (typeof loaded !== "object" || loaded === null || !("Kysely" in loaded) || !("sql" in loaded)) {
    throw new SeedRefusal("KYSELY_UNAVAILABLE", "Installed EmDash does not expose Kysely.");
  }
  return loaded as KyselyModule;
}

function persistInsideRepo(cwd: string, persist: string): string {
  const resolved = resolve(cwd, persist);
  const fromRoot = relative(cwd, resolved);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new SeedRefusal(
      "PERSIST_OUTSIDE_REPO",
      "Persist directory must stay inside this repository.",
    );
  }
  return resolved;
}

function readArgs(argv: readonly string[]): {
  remote: boolean;
  proveSentinel: boolean;
  persist: string;
  confirmation: string | undefined;
} {
  let remote = false;
  let proveSentinel = false;
  let persist = DEFAULT_PERSIST_PATH;
  let confirmation: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remote") {
      remote = true;
      continue;
    }
    if (arg === "--prove-sentinel") {
      proveSentinel = true;
      continue;
    }
    if (arg === "--confirm") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new SeedRefusal(
          "REMOTE_CONFIRMATION_MISSING",
          "--confirm needs the operator fingerprint. No proxy was opened.",
        );
      }
      confirmation = value;
      index += 1;
      continue;
    }
    if (arg === "--persist") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new SeedRefusal("PERSIST_REQUIRED", "--persist needs a directory path.");
      }
      persist = value;
      index += 1;
      continue;
    }
    throw new SeedRefusal("UNKNOWN_ARGUMENT", `Unknown argument ${arg ?? ""}.`);
  }
  return { remote, proveSentinel, persist, confirmation };
}

function emit(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function declaredIndexes(storage: StorageDeclaration | undefined): Array<string | string[]> {
  return [...(storage?.indexes ?? []), ...(storage?.uniqueIndexes ?? [])];
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function tryReadRepoFile(cwd: string, relativePath: string): string | undefined {
  const path = resolve(cwd, relativePath);
  const fromRoot = relative(cwd, path);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new SeedRefusal(
      "TARGET_PATH_ESCAPES",
      "Operator target files must stay inside this repository.",
    );
  }
  try {
    const text = readFileSync(path, "utf8");
    const real = realpathSync(path);
    const fromReal = relative(cwd, real);
    if (fromReal.startsWith("..") || isAbsolute(fromReal)) {
      throw new SeedRefusal(
        "TARGET_PATH_ESCAPES",
        "Operator target files must stay inside this repository.",
      );
    }
    return text;
  } catch (error) {
    if (error instanceof SeedRefusal) throw error;
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

function localDatabaseIds(cwd: string): string[] {
  const ids: string[] = [];
  const idText = tryReadRepoFile(cwd, LOCAL_ID_PATH);
  if (idText !== undefined && idText.trim() !== "") ids.push(idText.trim());
  const localText = tryReadRepoFile(cwd, LOCAL_CONFIG_PATH);
  if (localText === undefined) return ids;
  const parsed = parseWranglerConfig(parseJsonc(localText));
  if (parsed.databaseId !== undefined) ids.push(parsed.databaseId);
  return ids;
}

function evaluateRemoteTarget(cwd: string, confirmation: string | undefined): void {
  const manifestText = tryReadRepoFile(cwd, REMOTE_TARGET_MANIFEST_PATH);
  if (manifestText === undefined) {
    throw new SeedRefusal(
      "REMOTE_SEED_UNPROVED",
      "Remote D1 operator seeding is not established. No reviewed target manifest was found. No remote call was made.",
    );
  }
  const configText = tryReadRepoFile(cwd, REMOTE_CONFIG_PATH);
  if (configText === undefined) {
    throw new SeedRefusal(
      "REMOTE_CONFIG_MISSING",
      "Remote Wrangler config is missing. No proxy was opened.",
    );
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestText);
  } catch {
    throw new SeedRefusal(
      "REMOTE_TARGET_MANIFEST_INVALID",
      "Remote operator manifest is not JSON. No proxy was opened.",
    );
  }
  let configValue: unknown;
  try {
    configValue = parseJsonc(configText);
  } catch {
    throw new SeedRefusal(
      "CONFIG_INVALID",
      "Remote Wrangler config is not JSON. No proxy was opened.",
    );
  }
  assertRemoteOperatorTarget({
    config: parseWranglerConfig(configValue),
    manifest: parseRemoteTargetManifest(manifestValue),
    confirmation,
    localDatabaseIds: localDatabaseIds(cwd),
  });
}

const COMMERCE_INDEX_QUERY =
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?";

async function assertPhysicalCommerceSkuIndex(database: D1DatabaseBinding): Promise<void> {
  const result = await database.prepare(COMMERCE_INDEX_QUERY).bind(COMMERCE_SKU_UNIQUE_INDEX).all();
  const names: string[] = [];
  for (const row of result.results ?? []) {
    if (typeof row.name === "string") names.push(row.name);
  }
  assertCommerceSkuIndexPresent(names);
}

function repository<TRecord>(
  db: EmDashDb,
  collection: string,
  storage: StorageDeclaration | undefined,
): PluginStorageRepository<TRecord> {
  return new PluginStorageRepository<TRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    collection,
    declaredIndexes(storage),
  );
}

function snapshot(products: readonly CatalogRow[]): Map<string, CatalogRow> {
  return new Map(products.map((product) => [product.sku.toUpperCase(), product]));
}

function sameRow(left: CatalogRow, right: CatalogRow): boolean {
  return (
    left.catalogItemId === right.catalogItemId &&
    left.name === right.name &&
    left.sku === right.sku &&
    left.regular === right.regular &&
    left.sale === right.sale &&
    left.stockStatus === right.stockStatus
  );
}

async function readProducts(
  storage: Parameters<typeof listCatalogProducts>[0],
): Promise<CatalogRow[]> {
  const listed = await listCatalogProducts(storage);
  return listed.products.map((product) => ({
    catalogItemId: product.catalogItemId,
    name: product.name,
    sku: product.sku,
    regular: product.regular,
    sale: product.sale,
    stockStatus: product.stockStatus,
  }));
}

async function ensureProduct(
  storage: {
    catalog: PluginStorageRepository<CatalogStorageRecord>;
    prices: PluginStorageRepository<CatalogPriceRecord>;
    availability: PluginStorageRepository<CatalogManualAvailabilityRecord>;
  },
  existing: CatalogRow | undefined,
  product: DemoProductSeed | typeof SENTINEL,
): Promise<"created" | "updated"> {
  const variant = "variant" in product ? product.variant : undefined;
  let catalogItemId = existing?.catalogItemId;
  let action: "created" | "updated" = existing ? "updated" : "created";
  if (!catalogItemId) {
    const created = await createCatalogItem(storage.catalog, {
      commandId: product.commandId,
      manageStock: false,
      ...(variant ? { fulfillment: "physical" as const } : {}),
      name: product.name,
      sku: product.sku,
    });
    catalogItemId = created.item.itemId;
    action = created.created ? "created" : "updated";
  }

  if (variant) {
    await addCatalogVariantOption(
      { catalog: storage.catalog },
      {
        productId: catalogItemId,
        optionId: variant.optionId,
        optionLabel: variant.optionLabel,
        values: [
          {
            valueId: variant.values[0]!.valueId,
            label: variant.values[0]!.label,
            member: { catalogItemId, fulfillment: "physical" },
          },
          ...variant.values.slice(1).map((value) => ({
            valueId: value.valueId,
            label: value.label,
            member: {
              commandId: value.commandId,
              name: value.name,
              sku: value.sku,
              fulfillment: "physical" as const,
            },
          })),
        ],
      },
      { collection: CATALOG_COLLECTION, pluginId: COMMERCE_PLUGIN_ID },
    );
  }

  const itemIds = [catalogItemId];
  if (variant) {
    const parent = await storage.catalog.get(catalogItemId);
    if (parent && "variantProduct" in parent && parent.variantProduct) {
      itemIds.push(
        ...parent.variantProduct.members
          .map((member) => member.catalogItemId)
          .filter((memberId) => memberId !== catalogItemId),
      );
    }
  }

  for (const itemId of itemIds) {
    if (product.saleMinor === null) {
      await clearCatalogItemSalePrice(storage, { catalogItemId: itemId });
    }
    await setCatalogItemRegularPrice(storage, {
      catalogItemId: itemId,
      amount: { currency: "USD", minor: product.regularMinor },
    });
    if (product.saleMinor === null) {
      await clearCatalogItemSalePrice(storage, { catalogItemId: itemId });
    } else {
      await setCatalogItemSalePrice(storage, {
        catalogItemId: itemId,
        amount: { currency: "USD", minor: product.saleMinor },
      });
    }
    await setCatalogItemManualAvailability(storage, {
      catalogItemId: itemId,
      status: product.availability,
    });
    if (product.gallery) {
      await saveCatalogItemMedia(storage, {
        catalogItemId: itemId,
        gallery: product.gallery,
      });
    }
  }
  return action;
}

async function assertNeutralHome(db: EmDashDb, sql: KyselyModule["sql"]): Promise<void> {
  const collections = await sql<{ slug: string }>`
    select slug from _emdash_collections
    where slug in ('pages', 'products', 'categories')
  `.execute(db);
  const slugs = new Set(collections.rows.map((row) => row.slug));
  if (!slugs.has("pages") || !slugs.has("products") || !slugs.has("categories")) {
    throw new SeedRefusal(
      "CMS_CATEGORIES_MISSING",
      "Neutral EmDash pages, products, and categories were not initialized.",
    );
  }
  const home = await sql<{ slug: string; status: string; layout_length: number; content_length: number }>`
    select slug, status,
      length(cast(layout as text)) as layout_length,
      length(cast(content as text)) as content_length
    from ec_pages
    where slug = 'home'
    limit 2
  `.execute(db);
  if (home.rows.length !== 1) {
    throw new SeedRefusal("CMS_HOME_MISSING", "Neutral home page was not initialized.");
  }
  const row = home.rows[0];
  if (!row || row.status !== "published") {
    throw new SeedRefusal("CMS_HOME_UNPUBLISHED", "Neutral home page is not published.");
  }
  const layoutLength = Number(row.layout_length ?? 0);
  const contentLength = Number(row.content_length ?? 0);
  if (layoutLength <= 2 && contentLength <= 2) {
    throw new SeedRefusal(
      "CMS_HOME_EMPTY",
      "Neutral home page has no layout or portable text composition.",
    );
  }
  emit("seed.cms", {
    pages: true,
    products: true,
    categories: true,
    home: row.slug,
    status: row.status,
    composition: layoutLength > 2 ? "layout" : "content",
  });
}

function readCatalogProfile(configValue: unknown): string | undefined {
  if (!configValue || typeof configValue !== "object" || Array.isArray(configValue)) return undefined;
  const vars = (configValue as { vars?: unknown }).vars;
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) return undefined;
  const profile = (vars as { DINKUS_CATALOG_PROFILE?: unknown }).DINKUS_CATALOG_PROFILE;
  return typeof profile === "string" ? profile : undefined;
}

async function seedDemoProductEntries(
  db: EmDashDb,
  profile: string | undefined,
  catalogRows: readonly CatalogRow[],
): Promise<void> {
  const entries = buildDemoProductEntries(
    profile,
    catalogRows.map((row): DemoCatalogLink => ({
      sku: row.sku,
      catalogItemId: row.catalogItemId,
    })),
  );
  if (entries.length === 0) {
    emit("seed.cms.demo-products", { profile: profile ?? null, created: 0, skipped: 0 });
    return;
  }
  const result = await applySeed(db, {
    version: "1",
    content: { products: entries },
  } as SeedFile, {
    includeContent: true,
    onConflict: "skip",
  });
  emit("seed.cms.demo-products", {
    profile,
    requested: entries.length,
    created: result.content.created,
    skipped: result.content.skipped,
  });
}

async function ensureCmsSchema(db: EmDashDb, seedData: SeedFile): Promise<void> {
  const schemaSeed: SeedFile = { ...seedData, content: undefined };
  const applied = await applySeed(db, schemaSeed, {
    includeContent: false,
    onConflict: "skip",
    skipMediaDownload: true,
  });
  emit("seed.cms.schema", {
    collectionsCreated: applied.collections.created,
    collectionsSkipped: applied.collections.skipped,
    fieldsCreated: applied.fields.created,
    relationsCreated: applied.relations.created,
    menusCreated: applied.menus.created,
  });
}

async function seedCanonical(
  database: D1DatabaseBinding,
  cwd: string,
  proveSentinel: boolean,
  catalogProfile: string | undefined,
): Promise<void> {
  const platformEnv = globalThis as Record<symbol, unknown>;
  platformEnv[PLATFORM_ENV] = { DB: database };
  await assertPhysicalCommerceSkuIndex(database);
  const plugin = createPlugin();
  const { Kysely, sql } = kyselyFromEmDash();
  const db = new Kysely({ dialect: createDialect({ binding: DEMO_D1_BINDING }) });
  try {
    const migrations = await runMigrations(db);
    emit("seed.migrations", { applied: migrations.applied.length });

    const seedText = readFileSync(resolve(cwd, "seed/seed.json"), "utf8");
    const seedData: unknown = JSON.parse(seedText);
    const validation = validateSeed(seedData);
    if (!validation.valid) {
      throw new SeedRefusal("CMS_SEED_INVALID", validation.errors.join("; "));
    }
    if (process.env.DINKUS_SEED_TEST_LEGACY === "1") {
      await database.batch([
        database.prepare("DROP TABLE IF EXISTS ec_pages"),
        database.prepare("DROP TABLE IF EXISTS ec_products"),
        database.prepare("DROP TABLE IF EXISTS ec_categories"),
      ]);
      await db.deleteFrom("_emdash_media_usage_index_status")
        .where("scope_type", "=", "collection")
        .execute();
      await db.deleteFrom("_emdash_fields").execute();
      await db.deleteFrom("_emdash_collections").where("slug", "!=", "merchandise").execute();
      await applySeed(db, LEGACY_SCHEMA_SEED, {
        includeContent: false,
        onConflict: "skip",
      });
      emit("seed.test.legacy-schema", { merchandiseOnly: true });
    }
    await ensureCmsSchema(db, seedData as SeedFile);
    const applied = await applySeed(db, seedData as SeedFile, {
      includeContent: true,
      onConflict: "skip",
      skipMediaDownload: true,
    });
    emit("seed.cms.apply", {
      collectionsCreated: applied.collections.created,
      contentCreated: applied.content.created,
      contentSkipped: applied.content.skipped,
    });
    await assertNeutralHome(db, sql);

    const storageMap = plugin.storage as Record<string, StorageDeclaration> | undefined;
    if (!storageMap || storageMap[CATALOG_COLLECTION] === undefined) {
      throw new SeedRefusal(
        "COMMERCE_STORAGE_UNDECLARED",
        "Commerce plugin did not declare canonical storage constraints.",
      );
    }

    const storage = {
        catalog: repository<CatalogStorageRecord>(
          db,
          CATALOG_COLLECTION,
          storageMap[CATALOG_COLLECTION],
        ),
        prices: repository<CatalogPriceRecord>(
          db,
          CATALOG_PRICES_COLLECTION,
          storageMap[CATALOG_PRICES_COLLECTION],
        ),
        availability: repository<CatalogManualAvailabilityRecord>(
          db,
          CATALOG_MANUAL_AVAILABILITY_COLLECTION,
          storageMap[CATALOG_MANUAL_AVAILABILITY_COLLECTION],
        ),
        media: repository<CatalogMediaRecord>(
          db,
          CATALOG_MEDIA_COLLECTION,
          storageMap[CATALOG_MEDIA_COLLECTION],
        ),
      };

      if (proveSentinel) {
        const beforeSentinel = snapshot(await readProducts(storage));
        await ensureProduct(storage, beforeSentinel.get(SENTINEL.sku), SENTINEL);
      }

      const before = snapshot(await readProducts(storage));
      const nonDemoBefore = [...before.values()].filter((product) => !isDemoSku(product.sku));

      for (const product of DEMO_PRODUCTS) {
        const action = await ensureProduct(storage, before.get(product.sku), product);
        emit("seed.sku", {
          sku: product.sku,
          action,
          regularMinor: product.regularMinor,
          saleMinor: product.saleMinor,
          availability: product.availability,
        });
      }

      const after = snapshot(await readProducts(storage));
      await seedDemoProductEntries(db, catalogProfile, [...after.values()]);
      const nonDemoAfter = [...after.values()].filter((product) => !isDemoSku(product.sku));
      if (nonDemoBefore.length !== nonDemoAfter.length) {
        throw new SeedRefusal("NON_DEMO_MUTATED", "Non-demo catalog membership changed.");
      }
      for (const previous of nonDemoBefore) {
        const next = nonDemoAfter.find((product) => product.catalogItemId === previous.catalogItemId);
        if (!next || !sameRow(previous, next)) {
          throw new SeedRefusal("NON_DEMO_MUTATED", "A non-demo catalog record changed.");
        }
      }
      for (const product of DEMO_PRODUCTS) {
        if (!after.has(product.sku)) {
          throw new SeedRefusal("DEMO_SKU_MISSING", `${product.sku} was not stored.`);
        }
      }
      emit("seed.preserved", { nonDemo: nonDemoBefore.length, unchanged: true });
  } finally {
    await db.destroy();
  }
}

async function seedDemoProducts(): Promise<void> {
  const cwd = repoRoot();
  const args = readArgs(process.argv);
  if (!args.remote && args.confirmation !== undefined) {
    throw new SeedRefusal(
      "CONFIRM_WITHOUT_REMOTE",
      "--confirm is only valid with --remote. No proxy was opened.",
    );
  }
  assertInvocationAllowed({
    remote: args.remote,
    proveSentinel: args.proveSentinel,
    persist: args.persist,
    databasePath: process.env.D1_DB_PATH,
  });

  if (args.remote) {
    evaluateRemoteTarget(cwd, args.confirmation);
    const production = parseWranglerConfig(readConfig(resolve(cwd, PRODUCTION_CONFIG_PATH)));
    assertProductionConfig(production);
    emit("seed.target", {
      worker: production.name,
      binding: DEMO_D1_BINDING,
      databaseName: production.databaseName,
      remote: true,
      scope: "fresh-demo-only",
    });
    const proxy = await getPlatformProxy({
      configPath: resolve(cwd, REMOTE_CONFIG_PATH),
      remoteBindings: true,
      envFiles: [],
      persist: false,
    });
    try {
      const database: unknown = proxy.env.DB;
      if (!isD1DatabaseBinding(database)) {
        throw new SeedRefusal(
          "D1_BINDING_MISSING",
          "getPlatformProxy did not provide the configured DB binding.",
        );
      }
      const remoteConfig = readConfig(resolve(cwd, REMOTE_CONFIG_PATH));
      await seedCanonical(database, cwd, false, process.env.DINKUS_CATALOG_PROFILE ?? readCatalogProfile(remoteConfig));
    } finally {
      await proxy.dispose();
    }
    return;
  }

  execFileSync(process.execPath, ["scripts/write-local-wrangler.mjs"], {
    cwd,
    stdio: "inherit",
  });

  const productionConfig = readConfig(resolve(cwd, PRODUCTION_CONFIG_PATH));
  const production = parseWranglerConfig(productionConfig);
  assertProductionConfig(production);
  const expectedId = readFileSync(resolve(cwd, LOCAL_ID_PATH), "utf8").trim();
  const localConfig = readConfig(resolve(cwd, LOCAL_CONFIG_PATH));
  const local = parseWranglerConfig(localConfig);
  const identity = assertLocalConfig(local, expectedId);
  const persistPath = persistInsideRepo(cwd, args.persist);

  emit("seed.target", {
    worker: production.name,
    binding: DEMO_D1_BINDING,
    databaseName: production.databaseName,
    databaseId: identity.databaseId,
    remote: false,
  });

  const proxy = await getPlatformProxy({
    configPath: resolve(cwd, LOCAL_CONFIG_PATH),
    remoteBindings: false,
    envFiles: [],
    persist: { path: persistPath },
  });

  try {
    const database: unknown = proxy.env.DB;
    if (!isD1DatabaseBinding(database)) {
      throw new SeedRefusal(
        "D1_BINDING_MISSING",
        "getPlatformProxy did not provide the configured DB binding.",
      );
    }
    await seedCanonical(
      database,
      cwd,
      args.proveSentinel,
      process.env.DINKUS_CATALOG_PROFILE ?? readCatalogProfile(localConfig) ?? readCatalogProfile(productionConfig),
    );
  } finally {
    await proxy.dispose();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seedDemoProducts().catch((error: unknown) => {
    if (error instanceof SeedRefusal) {
      console.error(JSON.stringify({ event: "seed.refused", code: error.code, message: error.message }));
      process.exitCode = 2;
      return;
    }
    const message = error instanceof Error ? error.message : "Seed failed.";
    console.error(JSON.stringify({ event: "seed.failed", message }));
    process.exitCode = 1;
  });
}

export { seedDemoProducts };
