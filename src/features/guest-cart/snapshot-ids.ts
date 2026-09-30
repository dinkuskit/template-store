import { isSafeGuestCartProductId, GUEST_CART_MAX_LINES } from "./intent.js";

export function parseGuestCartSnapshotIds(raw: string | null): string[] | null {
  if (raw === null || raw.trim() === "") return [];
  const ids = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (ids.length > GUEST_CART_MAX_LINES) return null;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isSafeGuestCartProductId(id) || seen.has(id)) return null;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
