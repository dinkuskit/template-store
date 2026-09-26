import { createHash } from "node:crypto";
import { UNPRICED_PRODUCT_ITEM_ID } from "../unmanaged-product-sellability/index.js";

export type MerchRecord = Readonly<{
  id: string;
  title: string;
  category: string;
  description: string;
  visualLabel: string;
  availabilitySource: "managed" | "unmanaged" | "preview";
  illustration: "tee" | "hoodie" | "cap" | "beanie";
}>;

export type MerchCollection = Readonly<{
  name: string;
  items: readonly MerchRecord[];
}>;

/** Editorial content comes from EmDash; only exact demo entry IDs carry connected availability. */
export function buildMerchCollections(
  entries: readonly { id: string; data: Record<string, unknown> }[],
): readonly MerchCollection[] {
  const groups = new Map<string, MerchRecord[]>();
  for (const entry of entries) {
    if (entry.id === UNPRICED_PRODUCT_ITEM_ID) continue; // Commerce draft is never public.
    const { title, category, description, visual_label: visualLabel } = entry.data;
    if (
      typeof title !== "string" || !title.trim() ||
      typeof category !== "string" || !category.trim() ||
      (description !== undefined && typeof description !== "string") ||
      typeof visualLabel !== "string" || !visualLabel.trim() ||
      !productPath(entry.id)
    ) continue;
    const item: MerchRecord = {
      id: entry.id,
      title: title.trim(),
      category: category.trim(),
      description: typeof description === "string" ? description.trim() : "",
      visualLabel: visualLabel.trim(),
      availabilitySource: entry.id === "everyday-tee" ? "managed" : entry.id === "canvas-cap" ? "unmanaged" : "preview",
      illustration: ((): MerchRecord["illustration"] => {
        const style = visualLabel.trim().toLowerCase();
        return style === "hoodie" || style === "cap" || style === "beanie" ? style : "tee";
      })(),
    };
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }
  return [...groups].map(([name, items]) => ({ name, items })).sort((a, b) => a.name.localeCompare(b.name));
}

export function categoryAnchor(name: string): string {
  return `collection-${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`;
}

/** The digest keeps visually similar collection names from claiming one another's route. */
export function collectionPath(name: string): string {
  const slug = categoryAnchor(name).slice("collection-".length) || "collection";
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `/collections/${slug}-${digest}`;
}

/** Entry IDs, rather than editable names, are the stable product identity. */
export function productPath(id: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? `/products/${id}` : null;
}

/** A missing Commerce Regular price suppresses connected merchandise on every route. */
export function publicMerchCollections(collections: readonly MerchCollection[], managedListable: boolean, unmanagedListable: boolean): readonly MerchCollection[] {
  return collections.map(group => ({ ...group, items: group.items.filter(item =>
    item.availabilitySource === "preview" || (item.availabilitySource === "managed" ? managedListable : unmanagedListable)
  ) })).filter(group => group.items.length > 0);
}
