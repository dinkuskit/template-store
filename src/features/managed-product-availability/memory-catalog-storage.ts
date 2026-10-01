import {
  catalogUniqueIndexName,
  managedSkuRegistrationClaimUniqueIndexName,
  storeInventoryConfigurationUniqueIndexName,
  type CatalogPriceRecord,
  type CatalogPriceStorage,
  type CatalogStorage,
  type CatalogStorageRecord,
  type ConfigureInventoryCatalogStorage,
  type ConfigureInventoryClaimStorage,
  type ManagedSkuRegistrationClaimRecord,
  type StoreInventoryConfigurationStorage,
  type StoreInventoryConfigurationStorageRecord,
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

export type MemoryCatalogStorage = CatalogStorage &
  ConfigureInventoryCatalogStorage;

export function createMemoryCatalogStorage(): MemoryCatalogStorage {
  const records = new Map<string, CatalogStorageRecord>();
  const revisions = new Map<string, string>();

  function validateUniques(id: string, data: CatalogStorageRecord): void {
    for (const [existingId, existing] of records) {
      if (existingId === id) continue;
      if (existing.commandId === data.commandId) {
        throw uniqueViolation("commandId");
      }
      if (existing.skuKey === data.skuKey) {
        throw uniqueViolation("skuKey");
      }
    }
  }

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async getVersioned(id) {
      const record = records.get(id);
      if (record === undefined) return null;
      if (!revisions.has(id)) revisions.set(id, crypto.randomUUID());
      return {
        value: structuredClone(record),
        revision: revisions.get(id)!,
      };
    },

    async compareAndSet(id, expectedRevision, data) {
      const current = records.get(id);
      if (expectedRevision === null) {
        if (current !== undefined) return { applied: false };
      } else {
        if (current === undefined || revisions.get(id) !== expectedRevision) {
          return { applied: false };
        }
      }
      validateUniques(id, data);
      records.set(id, structuredClone(data));
      const revision = crypto.randomUUID();
      revisions.set(id, revision);
      return { applied: true, revision };
    },

    async put(id, data) {
      validateUniques(id, data);
      records.set(id, structuredClone(data));
      revisions.set(id, crypto.randomUUID());
    },

    async delete(id) {
      revisions.delete(id);
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

function configurationUniqueViolation(): Error {
  const index = storeInventoryConfigurationUniqueIndexName("configurationKey");
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

function createMemoryConfigurationStorage(): StoreInventoryConfigurationStorage {
  const records = new Map<string, StoreInventoryConfigurationStorageRecord>();

  return {
    async put(id, data) {
      for (const [existingId, existing] of records) {
        if (existingId !== id && existing.configurationKey === data.configurationKey) {
          throw configurationUniqueViolation();
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

function claimUniqueViolation(
  field: "claimKey" | "operationId",
): Error {
  const index = managedSkuRegistrationClaimUniqueIndexName(field);
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

function createMemoryClaimStorage(): ConfigureInventoryClaimStorage {
  const records = new Map<string, ManagedSkuRegistrationClaimRecord>();

  return {
    async put(id, data) {
      for (const [existingId, existing] of records) {
        if (existingId === id) continue;
        if (existing.claimKey === data.claimKey) {
          throw claimUniqueViolation("claimKey");
        }
        if (existing.operationId === data.operationId) {
          throw claimUniqueViolation("operationId");
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
  const revisions = new Map<string, string>();

  return {
    async get(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },

    async getVersioned(id) {
      const record = records.get(id);
      if (record === undefined) return null;
      if (!revisions.has(id)) revisions.set(id, crypto.randomUUID());
      return {
        value: structuredClone(record),
        revision: revisions.get(id)!,
      };
    },

    async compareAndSet(id, expectedRevision, data) {
      const current = records.get(id);
      if (expectedRevision === null) {
        if (current !== undefined) return { applied: false };
      } else {
        if (current === undefined || revisions.get(id) !== expectedRevision) {
          return { applied: false };
        }
      }
      records.set(id, structuredClone(data));
      const revision = crypto.randomUUID();
      revisions.set(id, revision);
      return { applied: true, revision };
    },

    async compareAndDelete(id, expectedRevision) {
      const current = records.get(id);
      if (current === undefined || revisions.get(id) !== expectedRevision) {
        return { applied: false };
      }
      records.delete(id);
      revisions.delete(id);
      return { applied: true };
    },

    async put(id, data) {
      records.set(id, structuredClone(data));
      revisions.set(id, crypto.randomUUID());
    },

    async delete(id) {
      revisions.delete(id);
      return records.delete(id);
    },
  };
}

export interface MemoryCommerceStorage {
  catalog: MemoryCatalogStorage;
  prices: CatalogPriceStorage;
  configurations: StoreInventoryConfigurationStorage;
  claims: ConfigureInventoryClaimStorage;
}

export function createMemoryCommerceStorage(): MemoryCommerceStorage {
  return {
    catalog: createMemoryCatalogStorage(),
    prices: createMemoryPriceStorage(),
    configurations: createMemoryConfigurationStorage(),
    claims: createMemoryClaimStorage(),
  };
}
