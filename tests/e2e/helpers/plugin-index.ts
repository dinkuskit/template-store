import { createHash } from "node:crypto";

/**
 * EmDash 1.5's SQLite name for a plugin storage unique index on one field: `uidx_plugin_` plus the first 32
 * hex digits of the SHA-256 of `[plugin, collection, [field]]` as JSON. EmDash 1.4 used
 * `uidx_plugin_<plugin>_<collection>_<field>`; 1.5 keeps that only for names with no underscore or capital,
 * which no Commerce collection has, and its migration 095 renames the old indexes.
 */
export const pluginUniqueIndexName = (pluginId: string, collection: string, field: string): string =>
  `uidx_plugin_${createHash("sha256").update(JSON.stringify([pluginId, collection, [field]])).digest("hex").slice(0, 32)}`;
