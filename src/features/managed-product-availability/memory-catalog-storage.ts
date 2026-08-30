import {
  catalogUniqueIndexName,
  type CatalogStorage,
  type CatalogStorageRecord,
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
  record: CatalogStorageRecord,
  field: string,
  expected: string | number | boolean | null,
): boolean {
  const value = (record as unknown as Record<string, unknown>)[field];
  return value === expected;
}

export function createMemoryCatalogStorage(): CatalogStorage {
  const records = new Map<string, CatalogStorageRecord>();

  return {
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
