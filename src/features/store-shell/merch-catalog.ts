import { UNPRICED_PRODUCT_ITEM_ID } from "../unmanaged-product-sellability/identity/index.js";

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
  slug: string;
  name: string;
  items: readonly MerchRecord[];
}>;

/** Editorial content comes from EmDash; Commerce links are validated by the page resolver. */
export function buildMerchCollections(
  entries: readonly { id: string; data: Record<string, unknown> }[],
  collectionEntries: readonly { id: string; data: Record<string, unknown> }[] = [],
): readonly MerchCollection[] {
  const groups = new Map<string, MerchRecord[]>();
  const collectionNames = new Map<string, string>();
  for (const entry of collectionEntries) {
    const title = typeof entry.data.title === "string" ? entry.data.title.trim() : "";
    if (title && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      collectionNames.set(entry.id, title);
      groups.set(entry.id, []);
    }
  }
  for (const entry of entries) {
    if (entry.id === UNPRICED_PRODUCT_ITEM_ID) continue; // Commerce draft is never public.
    const { title, categories, description, visual_label: visualLabel } = entry.data;
    const categorySlugs = Array.isArray(categories)
      ? categories.filter((value): value is string => typeof value === "string")
      : [];
    if (
      typeof title !== "string" || !title.trim() ||
      (description !== undefined && typeof description !== "string") ||
      typeof visualLabel !== "string" || !visualLabel.trim() ||
      !productPath(entry.id)
    ) continue;
    const commerceItemId = typeof entry.data.commerce_item_id === "string"
      ? entry.data.commerce_item_id
      : "";
    const item: MerchRecord = {
      id: entry.id,
      title: title.trim(),
      category: "",
      description: typeof description === "string" ? description.trim() : "",
      visualLabel: visualLabel.trim(),
      availabilitySource: commerceItemId === "dinkus-template-managed-product"
        ? "managed"
        : commerceItemId === "dinkus-template-unmanaged-product" ? "unmanaged" : "preview",
      illustration: ((): MerchRecord["illustration"] => {
        const style = visualLabel.trim().toLowerCase();
        return style === "hoodie" || style === "cap" || style === "beanie" ? style : "tee";
      })(),
    };
    for (const slug of categorySlugs) {
      const name = collectionNames.get(slug);
      if (!name) continue;
      const group = groups.get(slug) ?? [];
      group.push({ ...item, category: name });
      groups.set(slug, group);
    }
  }
  return [...collectionNames].map(([slug, name]) => ({
    slug,
    name,
    items: groups.get(slug) ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function categoryAnchor(name: string): string {
  return `collection-${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`;
}

export function categoryPath(nameOrSlug: string): string {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nameOrSlug)
    ? nameOrSlug
    : categoryAnchor(nameOrSlug).slice("collection-".length) || "category";
  return `/categories/${slug}`;
}

export const collectionPath = categoryPath;

/** Entry IDs, rather than editable names, are the stable product identity. */
export function productPath(id: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? `/products/${id}` : null;
}

/** A missing Commerce Regular price suppresses connected merchandise on every route. */
export function publicMerchCollections(collections: readonly MerchCollection[], managedListable: boolean, unmanagedListable: boolean): readonly MerchCollection[] {
  return collections.map(group => ({ ...group, items: group.items.filter(item =>
    item.availabilitySource === "preview" || (item.availabilitySource === "managed" ? managedListable : unmanagedListable)
  ) }));
}
