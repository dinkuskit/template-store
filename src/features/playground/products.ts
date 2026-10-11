import type { SeedFile } from "emdash/seed";

const categories = [
  ["hats", "Hats"],
  ["hoodies", "Hoodies"],
  ["tees", "Tees"],
] as const;

const products = [
  ["demo-hosted-shirt", "Dinkus Demo Heavyweight T-Shirt", "DEMO-HOSTED-SHIRT", "TEE", "tees", "A substantial cotton tee with an easy everyday fit."],
  ["demo-hosted-cap", "Dinkus Demo Structured Cap", "DEMO-HOSTED-CAP", "CAP", "hats", "A six-panel cap with a clean, structured crown."],
  ["demo-hosted-mug", "Dinkus Demo Ceramic Mug", "DEMO-HOSTED-MUG", "TEE", "tees", "A durable everyday mug for coffee, tea, or a desk-side drink."],
  ["demo-hosted-hoodie-s", "Dinkus Demo Everyday Hoodie", "DEMO-HOSTED-HOODIE-S", "HOODIE", "hoodies", "A midweight pullover layer with a relaxed everyday fit."],
  ["demo-hosted-tote", "Dinkus Demo Canvas Tote", "DEMO-HOSTED-TOTE", "TEE", "tees", "A sturdy carryall for daily errands and market runs."],
  ["demo-hosted-throw", "Dinkus Demo Woven Throw", "DEMO-HOSTED-THROW", "TEE", "tees", "A soft woven layer for the sofa, reading chair, or bed."],
  ["demo-hosted-tray", "Dinkus Demo Catchall Tray", "DEMO-HOSTED-TRAY", "TEE", "tees", "A compact tray for keys, glasses, and other small essentials."],
  ["demo-hosted-socks", "Dinkus Demo Ribbed Socks", "DEMO-HOSTED-SOCKS", "TEE", "tees", "A comfortable ribbed pair for everyday rotation."],
  ["demo-hosted-bottle", "Dinkus Demo Steel Bottle", "DEMO-HOSTED-BOTTLE", "TEE", "tees", "A simple insulated bottle sized for a day on the move."],
] as const;

export type PlaygroundCommerceLink = Readonly<{ sku: string; catalogItemId: string }>;

export function buildPlaygroundProductSeed(
  links: readonly PlaygroundCommerceLink[],
): SeedFile {
  const bySku = new Map(links.map((link) => [link.sku, link.catalogItemId]));
  return {
  version: "1",
  content: {
    categories: categories.map(([id, title]) => ({
      id,
      slug: id,
      status: "published" as const,
      data: { title, description: `Demo ${title.toLowerCase()} collection.` },
    })),
    products: products.flatMap(([id, title, sku, visualLabel, category, description]) => {
      const commerceItemId = bySku.get(sku);
      return commerceItemId ? [{
      id,
      slug: id,
      status: "published" as const,
      data: {
        title,
        categories: [category, ...(id === "demo-hosted-tote" ? ["hats"] : [])],
        commerce_item_id: commerceItemId,
        description,
        visual_label: visualLabel,
      },
      }] : [];
    }),
  },
  };
}

export const PLAYGROUND_PRODUCT_SEED = buildPlaygroundProductSeed(
  products.map(([, , sku]) => ({ sku, catalogItemId: sku })),
);
