import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { REVIEWS_REGISTRY_RUNTIME_ID, resolvePairedReviewsDir } from "../../../scripts/lib/paired-reviews.mjs";

// The installed DinkusKit Reviews: the pinned build the proof store mounts under its Registry id
// (scripts/lib/paired-reviews.mjs). The tests write shipped orders into that plugin's own storage, in the
// shape its request run keeps once the email went out, then use the store's pages; the pages ask the real
// plugin routes.
export const REVIEWS_ID: string = REVIEWS_REGISTRY_RUNTIME_ID;
const DATABASE = ".artifacts/e2e/content.db";
const DAY = 86_400_000;
const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sqlite = (statement: string) => execFileSync("sqlite3", ["-json", DATABASE, statement], { encoding: "utf8" });
function rows<T>(statement: string): T[] {
  const out = sqlite(statement).trim();
  return out ? JSON.parse(out) as T[] : [];
}

/** Fails with what to run when the proof store has no Reviews build to mount. */
export function requireReviews() {
  if (!resolvePairedReviewsDir(process.env) || !existsSync(DATABASE)) {
    throw new Error("The proof store runs the pinned DinkusKit Reviews: run pnpm prepare:reviews (bin/verify-web does it).");
  }
}

export interface AskedOrder { id: string; orderId: string; email: string; secret: string; link(productId: string, secret?: string): string; stopLink(secret?: string): string }

/**
 * A shipped order whose review request went out `askedDaysAgo` days ago: state `asked` with the SHA-256 of
 * the link's secret, as Reviews keeps it. The secret is only ever in the returned link.
 */
export function seedAskedOrder(key: string, lines: { productId: string; productName: string }[], { askedDaysAgo = 0, name = "Sam Taylor" } = {}): AskedOrder {
  const secret = createHash("sha256").update(`e2e-secret-${key}`).digest("hex");
  const id = `evt_${key}`, orderId = `ord-${key}`, now = Date.now();
  const shippedAt = new Date(now - (askedDaysAgo + 14) * DAY).toISOString();
  const order = { orderId, shippedAt, email: `${key}@example.test`, name, lines, state: "asked", receivedAt: shippedAt,
    askedAt: new Date(now - askedDaysAgo * DAY).toISOString(), key: createHash("sha256").update(secret).digest("hex"), tries: 1 };
  const columns = rows<{ name: string }>("PRAGMA table_info(_plugin_storage)").map((column) => column.name);
  const stamp = new Date().toISOString();
  const row: Record<string, string> = { plugin_id: REVIEWS_ID, collection: "shipped", id, data: JSON.stringify(order), created_at: stamp, updated_at: stamp,
    ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
  const keys = Object.keys(row).filter((column) => columns.includes(column));
  sqlite(`INSERT INTO _plugin_storage (${keys.join(",")}) VALUES (${keys.map((column) => sql(row[column]!)).join(",")})`);
  return { id, orderId, email: order.email, secret, link: (productId, k = secret) => `/review?o=${encodeURIComponent(id)}&p=${encodeURIComponent(productId)}&k=${k}`,
    // The link at the end of the request email (review-email-stop-link-20261122).
    stopLink: (k = secret) => `/review?o=${encodeURIComponent(id)}&k=${k}&stop=1` };
}

/** Every review and rating row Reviews keeps, as one string, to compare before and after a refused request. */
export function reviewsStorage(): string {
  return JSON.stringify(rows(`SELECT collection, id, data FROM _plugin_storage WHERE plugin_id = ${sql(REVIEWS_ID)} AND collection IN ('reviews','ratings') ORDER BY collection, id`));
}

export function keptReviews(orderId: string): Record<string, unknown>[] {
  return rows<{ data: string }>(`SELECT data FROM _plugin_storage WHERE plugin_id = ${sql(REVIEWS_ID)} AND collection = 'reviews'`)
    .map((row) => JSON.parse(row.data) as Record<string, unknown>).filter((row) => row.orderId === orderId);
}

export function keptRating(productId: string): { value: number; count: number } | null {
  const found = rows<{ data: string }>(`SELECT data FROM _plugin_storage WHERE plugin_id = ${sql(REVIEWS_ID)} AND collection = 'ratings' AND id = ${sql(productId)}`)[0];
  return found ? JSON.parse(found.data) as { value: number; count: number } : null;
}

/** Whether Reviews keeps a stop for this address: one record whose id is the SHA-256 of the address in lower case. */
export function keptStop(email: string): boolean {
  const id = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return rows(`SELECT id FROM _plugin_storage WHERE plugin_id = ${sql(REVIEWS_ID)} AND collection = 'stops' AND id = ${sql(id)}`).length === 1;
}

/** Every stop record Reviews keeps, as one string: ids and data, which must never hold an address. */
export function stopsStorage(): string {
  return JSON.stringify(rows(`SELECT id, data FROM _plugin_storage WHERE plugin_id = ${sql(REVIEWS_ID)} AND collection = 'stops' ORDER BY id`));
}
