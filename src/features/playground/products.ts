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

/**
 * The playground has no Commerce mount. These published editorial previews
 * use stable demo SKUs as their links and remain non-purchasable previews.
 */
export const PLAYGROUND_PRODUCT_SEED: SeedFile = {
  version: "1",
  content: {
    categories: categories.map(([id, title]) => ({
      id,
      slug: id,
      status: "published" as const,
      data: { title, description: `Demo ${title.toLowerCase()} collection.` },
    })),
    products: products.map(([id, title, commerceItemId, visualLabel, category, description]) => ({
      id,
      slug: id,
      status: "published" as const,
      data: {
        title,
        categories: [category],
        commerce_item_id: commerceItemId,
        description,
        visual_label: visualLabel,
      },
    })),
  },
};
