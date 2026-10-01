import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import {
  assertCommerceSkuIndexPresent,
  assertInvocationAllowed,
  assertLocalConfig,
  assertProductionConfig,
  assertRemoteOperatorTarget,
  COMMERCE_SKU_UNIQUE_INDEX,
  DEFAULT_PERSIST_PATH,
  DEMO_PRODUCTS,
  DEMO_SKUS,
  parseRemoteTargetManifest,
  parseWranglerConfig,
  SeedRefusal,
} from "../../scripts/demo-seed-policy.js";

const shared = {
  name: "dinkuskit-template-demo",
  compatibility_date: "2026-09-30",
  assets: { binding: "ASSETS", directory: "./dist/client", run_worker_first: true },
  ratelimits: [{ name: "RATE_LIMITER", namespace_id: "2026100101" }],
};

describe("demo seed resource identity", () => {
  it("accepts a names-only production config", () => {
    const config = parseWranglerConfig({
      ...shared,
      d1_databases: [{ binding: "DB", database_name: "dinkuskit-template-demo" }],
    });
    expect(() => assertProductionConfig(config)).not.toThrow();
  });

  it("rejects a committed placeholder or any production database id", () => {
    const config = parseWranglerConfig({
      ...shared,
      d1_databases: [
        {
          binding: "DB",
          database_name: "dinkuskit-template-demo",
          database_id: "dinkuskit-template-demo-local",
        },
      ],
    });
    expect(() => assertProductionConfig(config)).toThrow(SeedRefusal);
  });

  it("rejects the wrong binding, name, namespace, and asset bypass", () => {
    expect(() =>
      assertProductionConfig(
        parseWranglerConfig({
          ...shared,
          name: "other-worker",
          d1_databases: [{ binding: "DB", database_name: "dinkuskit-template-demo" }],
        }),
      ),
    ).toThrow(/worker/i);
    expect(() =>
      assertLocalConfig(
        parseWranglerConfig({
          ...shared,
          d1_databases: [
            {
              binding: "OTHER",
              database_name: "dinkuskit-template-demo",
              database_id: "11111111-1111-4111-8111-111111111111",
            },
          ],
        }),
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toThrow(SeedRefusal);
  });

  it("accepts only the matching generated local id", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const config = parseWranglerConfig({
      ...shared,
      d1_databases: [
        { binding: "DB", database_name: "dinkuskit-template-demo", database_id: id },
      ],
    });
    expect(assertLocalConfig(config, id).databaseId).toBe(id);
    expect(() => assertLocalConfig(config, "22222222-2222-4222-8222-222222222222")).toThrow(
      SeedRefusal,
    );
  });

  it("uses the wrangler dev v3 persist root", () => {
    expect(DEFAULT_PERSIST_PATH).toBe(".wrangler/state/v3");
  });

  it("refuses a database path and a remote sentinel before any proxy", () => {
    try {
      assertInvocationAllowed({
        remote: true,
        proveSentinel: false,
        persist: ".wrangler/state",
        databasePath: "/tmp/anywhere.sqlite",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SeedRefusal);
      expect((error as SeedRefusal).code).toBe("ARBITRARY_DB_PATH_REJECTED");
    }
    try {
      assertInvocationAllowed({
        remote: true,
        proveSentinel: true,
        persist: ".artifacts/seed-repeat-state",
        databasePath: undefined,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SeedRefusal);
      expect((error as SeedRefusal).code).toBe("SENTINEL_REMOTE_REJECTED");
    }
  });

  it("rejects a non-integer rate namespace before equality", () => {
    const database = {
      d1_databases: [{ binding: "DB", database_name: "dinkuskit-template-demo" }],
    };
    for (const namespaceId of [
      "dinkuskit-template-demo-public-20260930",
      "0",
      "01",
      "-1",
      "2026100101.0",
    ]) {
      try {
        parseWranglerConfig({
          ...shared,
          ...database,
          ratelimits: [{ name: "RATE_LIMITER", namespace_id: namespaceId }],
        });
        expect.unreachable(namespaceId);
      } catch (error) {
        expect(error).toBeInstanceOf(SeedRefusal);
        expect((error as SeedRefusal).code).toBe("RATE_NAMESPACE_INVALID");
      }
    }
    try {
      assertProductionConfig(
        parseWranglerConfig({
          ...shared,
          ...database,
          ratelimits: [{ name: "RATE_LIMITER", namespace_id: "1001" }],
        }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SeedRefusal);
      expect((error as SeedRefusal).code).toBe("RATE_NAMESPACE_MISMATCH");
    }
  });

  it("keeps the demo write set to the three hosted SKUs", () => {
    expect(DEMO_PRODUCTS.map((product) => product.sku)).toEqual([
      "DEMO-HOSTED-SHIRT",
      "DEMO-HOSTED-CAP",
      "DEMO-HOSTED-MUG",
    ]);
    expect(DEMO_SKUS.has("SENTINEL-KEEP")).toBe(false);
    expect(DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-CAP")?.saleMinor).toBe(
      "2400",
    );
    expect(DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-SHIRT")?.saleMinor).toBe(
      null,
    );
  });

  it("does not scan Miniflare files from the seeder source", () => {
    const source = readFileSync("scripts/seed-synthetic-demo.ts", "utf8");
    expect(source).not.toContain("miniflare-D1DatabaseObject");
    expect(source).not.toContain("readdirSync");
    expect(source).not.toContain(".sqlite");
    expect(source).toContain("getPlatformProxy");
    expect(source).toContain("remoteBindings: false");
    expect(source).not.toMatch(/["'][^"']*api-BBZlif0y\.mjs["']/);
    expect(source).not.toMatch(/["']emdash\/internal\/plugin-test-runtime["']/);
    expect(source).not.toContain("EmDashRuntime");
    expect(source).not.toContain("syncPluginStorageIndexesOnce");
    expect(source).not.toContain("CREATE UNIQUE INDEX");
    expect(source).not.toContain("CREATE INDEX");
    expect(source).toContain("assertCommerceSkuIndexPresent");
    expect(source).toContain("sqlite_master");
    expect(source).toContain("runMigrations");
    expect(source).toContain("applySeed");
    expect(source).toContain("proxy.dispose");
    const worker = readFileSync("src/worker.ts", "utf8");
    expect(worker).toContain("createScheduledHandler()");
    expect(worker).toContain("export { PluginBridge }");
    expect(worker).toContain("scheduled: createScheduledHandler()");
  });

  it("keeps the committed Wrangler config names-only", () => {
    const committed = readFileSync("wrangler.jsonc", "utf8");
    expect(committed).not.toContain("database_id");
    expect(committed).not.toContain("account_id");
    expect(committed).not.toContain("\"remote\"");
    expect(committed).toContain("\"namespace_id\": \"2026100101\"");
    expect(committed).not.toContain("dinkuskit-template-demo-public-20260930");
    expect(committed).toContain("2026-09-30");
    expect(committed).toContain("run_worker_first");
  });

  it("rejects a remote target that is not the reviewed fresh demo", () => {
    const accountId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const databaseId = "11111111-1111-4111-8111-111111111111";
    const localId = "22222222-2222-4222-8222-222222222222";
    const fingerprint = createHash("sha256")
      .update(
        [accountId, databaseId, "dinkuskit-template-demo", "dinkuskit-template-demo", "DB"].join("\n"),
      )
      .digest("hex");
    const config = (overrides: Record<string, unknown> = {}) =>
      parseWranglerConfig({
        ...shared,
        account_id: accountId,
        ...overrides,
        d1_databases: [
          {
            binding: "DB",
            database_name: "dinkuskit-template-demo",
            database_id: databaseId,
            remote: true,
            ...(overrides.database as Record<string, unknown> | undefined),
          },
        ],
      });
    const manifest = (overrides: Record<string, unknown> = {}) =>
      parseRemoteTargetManifest({
        workerName: "dinkuskit-template-demo",
        databaseName: "dinkuskit-template-demo",
        binding: "DB",
        accountId,
        databaseId,
        scope: "fresh-demo-only",
        confirmation: fingerprint,
        ...overrides,
      });

    expect(
      assertRemoteOperatorTarget({
        config: config(),
        manifest: manifest(),
        confirmation: fingerprint,
        localDatabaseIds: [localId],
      }).fingerprint,
    ).toBe(fingerprint);

    const refuse = (run: () => void, code: string) => {
      try {
        run();
        expect.unreachable(code);
      } catch (error) {
        expect(error).toBeInstanceOf(SeedRefusal);
        expect((error as SeedRefusal).code).toBe(code);
      }
    };

    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config({ database: { remote: false } }),
          manifest: manifest(),
          confirmation: fingerprint,
          localDatabaseIds: [],
        }),
      "REMOTE_BINDING_REQUIRED",
    );
    refuse(
      () =>
        parseWranglerConfig({
          ...shared,
          d1_databases: [
            {
              binding: "DB",
              database_name: "dinkuskit-template-demo",
              database_id: databaseId,
              preview_database_id: databaseId,
              remote: true,
            },
          ],
        }),
      "PREVIEW_DATABASE_REJECTED",
    );
    refuse(
      () =>
        parseWranglerConfig({
          ...shared,
          d1_databases: [
            { binding: "DB", database_name: "dinkuskit-template-demo", remote: true },
            { binding: "OTHER", database_name: "other", remote: true },
          ],
        }),
      "D1_BINDING_COUNT",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config({ name: "other-worker" }),
          manifest: manifest(),
          confirmation: fingerprint,
          localDatabaseIds: [],
        }),
      "WORKER_NAME_MISMATCH",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config(),
          manifest: manifest({ databaseName: "other-db" }),
          confirmation: fingerprint,
          localDatabaseIds: [],
        }),
      "REMOTE_TARGET_MISMATCH",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config(),
          manifest: manifest(),
          confirmation: fingerprint,
          localDatabaseIds: [databaseId],
        }),
      "LOCAL_UUID_AS_REMOTE",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config(),
          manifest: manifest({ accountId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
          confirmation: fingerprint,
          localDatabaseIds: [],
        }),
      "REMOTE_TARGET_MISMATCH",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config(),
          manifest: manifest(),
          confirmation: undefined,
          localDatabaseIds: [],
        }),
      "REMOTE_CONFIRMATION_MISSING",
    );
    refuse(
      () =>
        assertRemoteOperatorTarget({
          config: config(),
          manifest: manifest(),
          confirmation: "f".repeat(64),
          localDatabaseIds: [],
        }),
      "REMOTE_CONFIRMATION_MISMATCH",
    );
    refuse(
      () => parseRemoteTargetManifest({ ...manifest(), scope: "production" }),
      "REMOTE_SCOPE_UNCONFIRMED",
    );
    refuse(
      () =>
        assertProductionConfig(
          parseWranglerConfig({
            ...shared,
            account_id: accountId,
            d1_databases: [{ binding: "DB", database_name: "dinkuskit-template-demo" }],
          }),
        ),
      "PRODUCTION_ACCOUNT_ID_PRESENT",
    );
  });

  it("requires the physical Commerce skuKey index before writes", () => {
    expect(() => assertCommerceSkuIndexPresent([])).toThrow(SeedRefusal);
    expect(() =>
      assertCommerceSkuIndexPresent(["idx_plugin_dinkus-commerce_catalogItems_skuKey"]),
    ).toThrow(SeedRefusal);
    try {
      assertCommerceSkuIndexPresent(["idx_plugin_dinkus-commerce_catalogItems_skuKey"]);
      expect.unreachable();
    } catch (error) {
      expect((error as SeedRefusal).code).toBe("INDEX_INIT_REQUIRED");
      expect((error as SeedRefusal).message).toContain("scheduled-index-harness.mjs");
      expect((error as SeedRefusal).message).toContain("/__scheduled");
    }
    expect(() => assertCommerceSkuIndexPresent([COMMERCE_SKU_UNIQUE_INDEX])).not.toThrow();
  });
});
