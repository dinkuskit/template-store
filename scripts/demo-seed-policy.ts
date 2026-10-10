/**
 * Pure target checks for the synthetic demo seeder.
 * Writes go only through the configured D1 binding. This module never opens a database.
 */

import { createHash } from "node:crypto";

export const DEMO_WORKER_NAME = "dinkuskit-template-demo";
export const DEMO_D1_BINDING = "DB";
export const DEMO_D1_NAME = "dinkuskit-template-demo";
export const DEMO_COMPATIBILITY_DATE = "2026-09-30";
// Cloudflare namespace_id is a string containing a positive integer, unique per account.
export const DEMO_RATE_NAMESPACE = "2026100101";
export const LOCAL_CONFIG_PATH = ".artifacts/wrangler.local.jsonc";
export const LOCAL_ID_PATH = ".artifacts/local-d1-id";
export const PRODUCTION_CONFIG_PATH = "wrangler.jsonc";
export const REMOTE_CONFIG_PATH = ".artifacts/wrangler.remote.jsonc";
export const REMOTE_TARGET_MANIFEST_PATH = ".artifacts/remote-operator-target.json";
export const REMOTE_TARGET_SCOPE = "fresh-demo-only";
// getPlatformProxy uses this path as Miniflare's resource root.
// `wrangler dev --persist-to .wrangler/state` appends `/v3` before it opens D1.
export const DEFAULT_PERSIST_PATH = ".wrangler/state/v3";
export const COMMERCE_SKU_UNIQUE_INDEX =
  "uidx_plugin_dinkus-commerce_catalogItems_skuKey";
export const SCHEDULED_HARNESS_RELATIVE = "scripts/scheduled-index-harness.mjs";

const DATABASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID_HEX = /^[0-9a-f]{32}$/;
const CONFIRMATION_HEX = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_NAMESPACE = /^[1-9][0-9]*$/;
const NIL_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const MAX_DATABASE_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

export interface DemoProductSeed {
  commandId: string;
  name: string;
  description: string;
  sku: string;
  regularMinor: string;
  saleMinor: string | null;
  availability: "in-stock" | "out-of-stock";
  variant?: {
    optionId: string;
    optionLabel: string;
    values: readonly {
      valueId: string;
      label: string;
      commandId: string;
      name: string;
      sku: string;
    }[];
  };
}

export const DEMO_PRODUCTS: readonly DemoProductSeed[] = Object.freeze([
  {
    commandId: "seed-demo-shirt",
    name: "Dinkus Demo Heavyweight T-Shirt",
    description: "A substantial cotton tee with an easy everyday fit.",
    sku: "DEMO-HOSTED-SHIRT",
    regularMinor: "3200",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-cap",
    name: "Dinkus Demo Structured Cap",
    description: "A six-panel cap with a clean, structured crown.",
    sku: "DEMO-HOSTED-CAP",
    regularMinor: "2800",
    saleMinor: "2400",
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-mug",
    name: "Dinkus Demo Ceramic Mug",
    description: "A durable everyday mug for coffee, tea, or a desk-side drink.",
    sku: "DEMO-HOSTED-MUG",
    regularMinor: "1800",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-hoodie",
    name: "Dinkus Demo Everyday Hoodie",
    description: "A midweight pullover layer with a relaxed everyday fit.",
    sku: "DEMO-HOSTED-HOODIE-S",
    regularMinor: "5600",
    saleMinor: null,
    availability: "in-stock",
    variant: {
      optionId: "size",
      optionLabel: "Size",
      values: [
        {
          valueId: "small",
          label: "Small",
          commandId: "seed-demo-hoodie-small",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-S",
        },
        {
          valueId: "medium",
          label: "Medium",
          commandId: "seed-demo-hoodie-medium",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-M",
        },
      ],
    },
  },
  {
    commandId: "seed-demo-tote",
    name: "Dinkus Demo Canvas Tote",
    description: "A sturdy carryall for daily errands and market runs.",
    sku: "DEMO-HOSTED-TOTE",
    regularMinor: "2600",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-throw",
    name: "Dinkus Demo Woven Throw",
    description: "A soft woven layer for the sofa, reading chair, or bed.",
    sku: "DEMO-HOSTED-THROW",
    regularMinor: "4800",
    saleMinor: "4200",
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-tray",
    name: "Dinkus Demo Catchall Tray",
    description: "A compact tray for keys, glasses, and other small essentials.",
    sku: "DEMO-HOSTED-TRAY",
    regularMinor: "2200",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-socks",
    name: "Dinkus Demo Ribbed Socks",
    description: "A comfortable ribbed pair for everyday rotation.",
    sku: "DEMO-HOSTED-SOCKS",
    regularMinor: "1400",
    saleMinor: null,
    availability: "out-of-stock",
  },
  {
    commandId: "seed-demo-bottle",
    name: "Dinkus Demo Steel Bottle",
    description: "A simple insulated bottle sized for a day on the move.",
    sku: "DEMO-HOSTED-BOTTLE",
    regularMinor: "3000",
    saleMinor: null,
    availability: "in-stock",
  },
]);

export const DEMO_SKUS: ReadonlySet<string> = new Set([
  ...DEMO_PRODUCTS.map((product) => product.sku),
  ...DEMO_PRODUCTS.flatMap((product) => product.variant?.values.map((value) => value.sku) ?? []),
]);

export class SeedRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SeedRefusal";
    this.code = code;
  }
}

export interface ParsedWranglerConfig {
  name: string;
  compatibilityDate: string;
  rateNamespace: string;
  runWorkerFirst: boolean;
  binding: string;
  databaseName: string;
  databaseId?: string;
  accountId?: string;
  bindingRemote: boolean;
}

export interface RemoteTargetManifest {
  workerName: string;
  databaseName: string;
  binding: string;
  accountId: string;
  databaseId: string;
  scope: typeof REMOTE_TARGET_SCOPE;
  confirmation: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SeedRefusal("CONFIG_INVALID", `${label} must be a non-empty string.`);
  }
  return value;
}

function readRateNamespace(value: unknown): string {
  const namespace = readString(value, "rate limit namespace_id");
  if (!POSITIVE_INTEGER_NAMESPACE.test(namespace)) {
    throw new SeedRefusal(
      "RATE_NAMESPACE_INVALID",
      "Rate limit namespace_id must be a string containing a positive integer.",
    );
  }
  return namespace;
}

export function parseWranglerConfig(value: unknown): ParsedWranglerConfig {
  if (!isRecord(value)) {
    throw new SeedRefusal("CONFIG_INVALID", "Wrangler config must be an object.");
  }
  if (!Array.isArray(value.d1_databases) || value.d1_databases.length !== 1) {
    throw new SeedRefusal(
      "D1_BINDING_COUNT",
      "Wrangler config must declare exactly one D1 database.",
    );
  }
  const database = value.d1_databases[0];
  if (!isRecord(database)) {
    throw new SeedRefusal("CONFIG_INVALID", "D1 database entry must be an object.");
  }
  if ("preview_database_id" in database) {
    throw new SeedRefusal(
      "PREVIEW_DATABASE_REJECTED",
      "Preview D1 database ids are not a seed target.",
    );
  }
  const assets = value.assets;
  const ratelimits = value.ratelimits;
  if (!Array.isArray(ratelimits) || ratelimits.length !== 1 || !isRecord(ratelimits[0])) {
    throw new SeedRefusal("RATE_NAMESPACE_INVALID", "Exactly one rate limit namespace is required.");
  }
  const runWorkerFirst = isRecord(assets) && assets.run_worker_first === true;
  const databaseId = database.database_id;
  let bindingRemote = false;
  if ("remote" in database) {
    if (typeof database.remote !== "boolean") {
      throw new SeedRefusal("CONFIG_INVALID", "D1 remote must be a boolean when set.");
    }
    bindingRemote = database.remote;
  }
  let accountId: string | undefined;
  if ("account_id" in value) {
    accountId = readString(value.account_id, "account_id");
  }
  return {
    name: readString(value.name, "worker name"),
    compatibilityDate: readString(value.compatibility_date, "compatibility_date"),
    rateNamespace: readRateNamespace(ratelimits[0].namespace_id),
    runWorkerFirst,
    binding: readString(database.binding, "D1 binding"),
    databaseName: readString(database.database_name, "D1 database_name"),
    bindingRemote,
    ...(typeof databaseId === "string" ? { databaseId } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
  };
}

function assertSharedIdentity(config: ParsedWranglerConfig): void {
  if (config.name !== DEMO_WORKER_NAME) {
    throw new SeedRefusal(
      "WORKER_NAME_MISMATCH",
      `Seed target worker must be ${DEMO_WORKER_NAME}.`,
    );
  }
  if (config.binding !== DEMO_D1_BINDING) {
    throw new SeedRefusal(
      "D1_BINDING_MISMATCH",
      `Seed target binding must be ${DEMO_D1_BINDING}.`,
    );
  }
  if (config.databaseName !== DEMO_D1_NAME) {
    throw new SeedRefusal(
      "D1_NAME_MISMATCH",
      `Seed target database name must be ${DEMO_D1_NAME}.`,
    );
  }
  if (config.compatibilityDate !== DEMO_COMPATIBILITY_DATE) {
    throw new SeedRefusal(
      "COMPATIBILITY_DATE_MISMATCH",
      `Compatibility date must be ${DEMO_COMPATIBILITY_DATE}.`,
    );
  }
  if (!POSITIVE_INTEGER_NAMESPACE.test(config.rateNamespace)) {
    throw new SeedRefusal(
      "RATE_NAMESPACE_INVALID",
      "Rate limit namespace_id must be a string containing a positive integer.",
    );
  }
  if (config.rateNamespace !== DEMO_RATE_NAMESPACE) {
    throw new SeedRefusal(
      "RATE_NAMESPACE_MISMATCH",
      `Rate limit namespace must be ${DEMO_RATE_NAMESPACE}.`,
    );
  }
  if (!config.runWorkerFirst) {
    throw new SeedRefusal(
      "ASSETS_BYPASS",
      "Assets must set run_worker_first so the public guard cannot be skipped.",
    );
  }
}

function assertMaterializedAccountId(accountId: string): string {
  const canonical = accountId.toLowerCase();
  if (!ACCOUNT_ID_HEX.test(canonical) && !DATABASE_ID_PATTERN.test(canonical)) {
    throw new SeedRefusal(
      "REMOTE_ACCOUNT_ID_INVALID",
      "Remote account id must be a UUID or a 32-character Cloudflare account id.",
    );
  }
  if (canonical === NIL_DATABASE_ID || canonical === MAX_DATABASE_ID) {
    throw new SeedRefusal(
      "REMOTE_ACCOUNT_ID_INVALID",
      "Remote account id must not be the nil or max UUID.",
    );
  }
  return canonical;
}

function assertMaterializedDatabaseId(databaseId: string): string {
  if (!DATABASE_ID_PATTERN.test(databaseId)) {
    throw new SeedRefusal(
      "REMOTE_DATABASE_ID_INVALID",
      "Remote D1 database_id must be a UUID.",
    );
  }
  const canonical = databaseId.toLowerCase();
  if (canonical === NIL_DATABASE_ID || canonical === MAX_DATABASE_ID) {
    throw new SeedRefusal(
      "REMOTE_DATABASE_ID_INVALID",
      "Remote D1 database_id must not be the nil or max UUID.",
    );
  }
  if (canonical === "dinkuskit-template-demo-local") {
    throw new SeedRefusal(
      "PLACEHOLDER_DATABASE_ID",
      "The placeholder database id is not a seed target.",
    );
  }
  return canonical;
}

export function assertProductionConfig(config: ParsedWranglerConfig): void {
  assertSharedIdentity(config);
  if (config.databaseId !== undefined) {
    throw new SeedRefusal(
      "PRODUCTION_DATABASE_ID_PRESENT",
      "Committed Wrangler config must name the D1 database and omit database_id. Parent materializes the real id after review.",
    );
  }
  if (config.accountId !== undefined) {
    throw new SeedRefusal(
      "PRODUCTION_ACCOUNT_ID_PRESENT",
      "Committed Wrangler config must omit account_id.",
    );
  }
  if (config.bindingRemote) {
    throw new SeedRefusal(
      "PRODUCTION_REMOTE_BINDING",
      "Committed Wrangler config must not mark the D1 binding remote.",
    );
  }
}

export function assertLocalDatabaseId(databaseId: string): string {
  if (!DATABASE_ID_PATTERN.test(databaseId)) {
    throw new SeedRefusal(
      "LOCAL_DATABASE_ID_INVALID",
      "Local D1 database_id must be a generated UUID in the ignored local config.",
    );
  }
  const canonical = databaseId.toLowerCase();
  if (canonical === NIL_DATABASE_ID || canonical === MAX_DATABASE_ID) {
    throw new SeedRefusal(
      "LOCAL_DATABASE_ID_INVALID",
      "Local D1 database_id must not be the nil or max UUID.",
    );
  }
  if (databaseId === "dinkuskit-template-demo-local") {
    throw new SeedRefusal(
      "PLACEHOLDER_DATABASE_ID",
      "The placeholder database id is not a seed target.",
    );
  }
  return canonical;
}

export function assertLocalConfig(
  config: ParsedWranglerConfig,
  expectedDatabaseId: string,
): { databaseId: string } {
  assertSharedIdentity(config);
  if (config.bindingRemote) {
    throw new SeedRefusal(
      "LOCAL_REMOTE_BINDING",
      "The local seed config must keep the D1 binding remote false.",
    );
  }
  if (config.databaseId === undefined) {
    throw new SeedRefusal(
      "LOCAL_DATABASE_ID_MISSING",
      "Ignored local Wrangler config must contain the generated database_id.",
    );
  }
  const databaseId = assertLocalDatabaseId(config.databaseId);
  if (databaseId !== assertLocalDatabaseId(expectedDatabaseId)) {
    throw new SeedRefusal(
      "LOCAL_ID_MISMATCH",
      "Local Wrangler database_id does not match the generated id file.",
    );
  }
  return { databaseId };
}

export interface SeedInvocation {
  remote: boolean;
  proveSentinel: boolean;
  persist: string;
  databasePath: string | undefined;
}

export function assertInvocationAllowed(invocation: SeedInvocation): void {
  if (invocation.databasePath !== undefined && invocation.databasePath !== "") {
    throw new SeedRefusal(
      "ARBITRARY_DB_PATH_REJECTED",
      "D1_DB_PATH is not a supported seed target. Use the configured D1 binding.",
    );
  }
  if (invocation.remote && invocation.proveSentinel) {
    throw new SeedRefusal(
      "SENTINEL_REMOTE_REJECTED",
      "The non-demo sentinel proof cannot run against a remote target.",
    );
  }
  if (invocation.proveSentinel && invocation.persist === DEFAULT_PERSIST_PATH) {
    throw new SeedRefusal(
      "SENTINEL_PERSIST_ISOLATION",
      "The sentinel proof must use an isolated persist directory, not the demo runtime state.",
    );
  }
}

export function remoteOperatorFingerprint(parts: {
  accountId: string;
  databaseId: string;
  workerName: string;
  databaseName: string;
  binding: string;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.accountId.toLowerCase(),
        parts.databaseId.toLowerCase(),
        parts.workerName,
        parts.databaseName,
        parts.binding,
      ].join("\n"),
    )
    .digest("hex");
}

export function parseRemoteTargetManifest(value: unknown): RemoteTargetManifest {
  if (!isRecord(value)) {
    throw new SeedRefusal(
      "REMOTE_TARGET_MANIFEST_INVALID",
      "Remote operator manifest must be an object.",
    );
  }
  if ("previewDatabaseId" in value || "preview_database_id" in value) {
    throw new SeedRefusal(
      "PREVIEW_DATABASE_REJECTED",
      "Preview D1 database ids are not a seed target.",
    );
  }
  const scope = readString(value.scope, "remote target scope");
  if (scope !== REMOTE_TARGET_SCOPE) {
    throw new SeedRefusal(
      "REMOTE_SCOPE_UNCONFIRMED",
      "Remote operator manifest must set scope to fresh-demo-only.",
    );
  }
  return {
    workerName: readString(value.workerName, "manifest workerName"),
    databaseName: readString(value.databaseName, "manifest databaseName"),
    binding: readString(value.binding, "manifest binding"),
    accountId: readString(value.accountId, "manifest accountId"),
    databaseId: readString(value.databaseId, "manifest databaseId"),
    scope: REMOTE_TARGET_SCOPE,
    confirmation: readString(value.confirmation, "manifest confirmation"),
  };
}

export function assertRemoteOperatorTarget(args: {
  config: ParsedWranglerConfig;
  manifest: RemoteTargetManifest;
  confirmation: string | undefined;
  localDatabaseIds: readonly string[];
}): { fingerprint: string } {
  assertSharedIdentity(args.config);
  if (!args.config.bindingRemote) {
    throw new SeedRefusal(
      "REMOTE_BINDING_REQUIRED",
      "Remote seeding requires the DB binding to set remote true.",
    );
  }
  if (args.config.databaseId === undefined) {
    throw new SeedRefusal(
      "REMOTE_DATABASE_ID_MISSING",
      "Remote Wrangler config must materialize database_id. No proxy was opened.",
    );
  }
  if (args.config.accountId === undefined) {
    throw new SeedRefusal(
      "REMOTE_ACCOUNT_ID_MISSING",
      "Remote Wrangler config must materialize account_id. No proxy was opened.",
    );
  }
  const databaseId = assertMaterializedDatabaseId(args.config.databaseId);
  const accountId = assertMaterializedAccountId(args.config.accountId);
  const manifestDatabaseId = assertMaterializedDatabaseId(args.manifest.databaseId);
  const manifestAccountId = assertMaterializedAccountId(args.manifest.accountId);
  if (
    args.manifest.workerName !== DEMO_WORKER_NAME ||
    args.manifest.databaseName !== DEMO_D1_NAME ||
    args.manifest.binding !== DEMO_D1_BINDING
  ) {
    throw new SeedRefusal(
      "REMOTE_TARGET_MISMATCH",
      "Remote manifest target does not match the demo worker, database name, and DB binding.",
    );
  }
  if (manifestDatabaseId !== databaseId || manifestAccountId !== accountId) {
    throw new SeedRefusal(
      "REMOTE_TARGET_MISMATCH",
      "Remote config account and database ids do not match the operator manifest.",
    );
  }
  for (const localId of args.localDatabaseIds) {
    if (localId.trim().toLowerCase() === databaseId) {
      throw new SeedRefusal(
        "LOCAL_UUID_AS_REMOTE",
        "The local D1 UUID is not a remote seed target.",
      );
    }
  }
  const fingerprint = remoteOperatorFingerprint({
    accountId,
    databaseId,
    workerName: args.manifest.workerName,
    databaseName: args.manifest.databaseName,
    binding: args.manifest.binding,
  });
  if (args.confirmation === undefined || args.confirmation.trim() === "") {
    throw new SeedRefusal(
      "REMOTE_CONFIRMATION_MISSING",
      "Remote seeding requires --confirm with the operator fingerprint. No proxy was opened.",
    );
  }
  if (!CONFIRMATION_HEX.test(args.confirmation) || args.manifest.confirmation !== fingerprint || args.confirmation !== fingerprint) {
    throw new SeedRefusal(
      "REMOTE_CONFIRMATION_MISMATCH",
      "Remote confirmation fingerprint does not match the account, database, name, and binding. No proxy was opened.",
    );
  }
  return { fingerprint };
}

export const INDEX_INIT_MESSAGE =
  `Canonical Commerce unique index ${COMMERCE_SKU_UNIQUE_INDEX} is absent. Before any seed write, initialize it with the built Worker scheduled harness: node ${SCHEDULED_HARNESS_RELATIVE} --persist <getPlatformProxy persist path ending in /v3>. That runs wrangler dev --test-scheduled --local --ip 127.0.0.1 against the Astro Cloudflare build and requests loopback /__scheduled. Public fetch still denies /__scheduled. No index SQL was authored.`;

export function assertCommerceSkuIndexPresent(indexNames: readonly string[]): void {
  if (!indexNames.includes(COMMERCE_SKU_UNIQUE_INDEX)) {
    throw new SeedRefusal("INDEX_INIT_REQUIRED", INDEX_INIT_MESSAGE);
  }
}

export function isDemoSku(sku: string): boolean {
  return DEMO_SKUS.has(sku.toUpperCase());
}
