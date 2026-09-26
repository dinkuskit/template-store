import {
  catalogUniqueIndexName,
  type CatalogBackorderPolicyRecord,
  type CatalogBackorderPolicyStorage,
  type CatalogItemReadStorage,
  type CatalogManualAvailabilityRecord,
  type CatalogManualAvailabilityStorage,
  type CatalogPriceRecord,
  type CatalogPriceStorage,
  type CatalogStorage,
  type CatalogStorageRecord,
  type StorefrontAvailabilitySettingsRecord,
  type StorefrontAvailabilitySettingsStorage,
  type StoreInventoryConfigurationStorage,
} from "@dinkuskit/commerce";

function uniqueViolation(field: "commandId" | "skuKey"): Error {
  const index = catalogUniqueIndexName(field);
  const error = new Error(
    `SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: ${index}`,
  );
  Object.assign(error, {
    code: "SQLITE_CONSTRAINT_UNIQUE",
    constraint: index,
    index,
  });
  return error;
}

function primitiveMatches(
  record: object,
  field: string,
  expected: string | number | boolean | null,
): boolean {
  const value = (record as unknown as Record<string, unknown>)[field];
  return value === expected;
}

export type MemoryUnmanagedCatalogStorage = CatalogStorage & CatalogItemReadStorage;

export function createMemoryCatalogStorage(): MemoryUnmanagedCatalogStorage {
  const records = new Map<string, CatalogStorageRecord>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async put(id, data) {
      for (const [existingId, existing] of records) {
        if (existingId === id) continue;
        if (existing.commandId === data.commandId) {
          throw uniqueViolation("commandId");
        }
        if (existing.skuKey === data.skuKey) {
          throw uniqueViolation("skuKey");
        }
      }
      records.set(id, structuredClone(data));
    },

    async delete(id) {
      return records.delete(id);
    },

    async query(options = {}) {
      const where = options.where ?? {};
      const limit = options.limit ?? 50;
      const items = [...records.entries()]
        .filter(([, record]) =>
          Object.entries(where).every(([field, expected]) =>
            typeof expected === "object" && expected !== null
              ? false
              : primitiveMatches(record, field, expected),
          ),
        )
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: structuredClone(data) }));
      return { items, hasMore: false };
    },
  };
}

export function createMemoryPriceStorage(): CatalogPriceStorage {
  const records = new Map<string, CatalogPriceRecord>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async put(id, data) {
      records.set(id, structuredClone(data));
    },

    async delete(id) {
      return records.delete(id);
    },
  };
}

export function createMemoryManualAvailabilityStorage(): CatalogManualAvailabilityStorage {
  const records = new Map<string, CatalogManualAvailabilityRecord>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async put(id, data) {
      records.set(id, structuredClone(data));
    },
  };
}

export function createMemoryBackorderPolicyStorage(): CatalogBackorderPolicyStorage {
  const records = new Map<string, CatalogBackorderPolicyRecord>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async put(id, data) {
      records.set(id, structuredClone(data));
    },
  };
}

export function createMemoryAvailabilitySettingsStorage(): StorefrontAvailabilitySettingsStorage {
  const records = new Map<string, StorefrontAvailabilitySettingsRecord>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async put(id, data) {
      records.set(id, structuredClone(data));
    },
  };
}

export function createUnusedConfigurationStorage(): StoreInventoryConfigurationStorage {
  return {
    async put() {
      throw new Error("unmanaged sellability must not write Inventory configuration");
    },
    async delete() {
      throw new Error("unmanaged sellability must not write Inventory configuration");
    },
    async query() {
      return { items: [], hasMore: false };
    },
  };
}
