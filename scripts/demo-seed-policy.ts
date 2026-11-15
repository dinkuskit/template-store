/**
 * The synthetic demo catalog: the products every demo store seeds through the installed Commerce
 * (src/features/playground/demo-registry-seed.ts on a store running Commerce's Registry build, and the
 * playground's in-store seed), with the prices, stock and choices each one gets. Data only; no database here.
 */

export interface DemoProductSeed {
  commandId: string;
  name: string;
  description: string;
  sku: string;
  regularMinor: string;
  saleMinor: string | null;
  availability: "in-stock" | "out-of-stock";
  /** Variant choices: options in display order, then every member. The first member is the product itself. */
  variant?: {
    options: readonly {
      optionId: string;
      optionLabel: string;
      values: readonly { valueId: string; label: string }[];
    }[];
    members: readonly {
      commandId: string;
      name: string;
      sku: string;
      /** Option id to value id, one entry per option. */
      selections: Readonly<Record<string, string>>;
      /** Member regular price; defaults to the product's regularMinor. */
      regularMinor?: string;
      /** Member availability; defaults to the product's availability. */
      availability?: "in-stock" | "out-of-stock";
    }[];
  };
}

export const DEMO_PRODUCTS: readonly DemoProductSeed[] = Object.freeze([
  {
    commandId: "seed-demo-shirt",
    name: "Dinkus Demo Heavyweight T-Shirt",
    description: "A substantial cotton tee with an easy everyday fit.",
    sku: "DEMO-HOSTED-SHIRT",
    regularMinor: "3200",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-cap",
    name: "Dinkus Demo Structured Cap",
    description: "A six-panel cap with a clean, structured crown.",
    sku: "DEMO-HOSTED-CAP",
    regularMinor: "2800",
    saleMinor: "2400",
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-mug",
    name: "Dinkus Demo Ceramic Mug",
    description: "A durable everyday mug for coffee, tea, or a desk-side drink.",
    sku: "DEMO-HOSTED-MUG",
    regularMinor: "1800",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-hoodie",
    name: "Dinkus Demo Everyday Hoodie",
    description: "A midweight pullover layer with a relaxed everyday fit.",
    sku: "DEMO-HOSTED-HOODIE-S",
    regularMinor: "5600",
    saleMinor: null,
    availability: "in-stock",
    variant: {
      options: [
        {
          optionId: "color",
          optionLabel: "Color",
          values: [
            { valueId: "black", label: "Black" },
            { valueId: "heather-gray", label: "Heather gray" },
          ],
        },
        {
          optionId: "size",
          optionLabel: "Size",
          values: [
            { valueId: "small", label: "Small" },
            { valueId: "medium", label: "Medium" },
            { valueId: "large", label: "Large" },
          ],
        },
      ],
      members: [
        {
          commandId: "seed-demo-hoodie-small",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-S",
          selections: { color: "black", size: "small" },
        },
        {
          commandId: "seed-demo-hoodie-medium",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-M",
          selections: { color: "black", size: "medium" },
          regularMinor: "6000",
        },
        {
          // Sold out by default so every demo store has an unavailable choice to show.
          commandId: "seed-demo-hoodie-large",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-L",
          selections: { color: "black", size: "large" },
          regularMinor: "6000",
          availability: "out-of-stock",
        },
        {
          commandId: "seed-demo-hoodie-heather-gray-small",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-HG-S",
          selections: { color: "heather-gray", size: "small" },
        },
        {
          commandId: "seed-demo-hoodie-heather-gray-medium",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-HG-M",
          selections: { color: "heather-gray", size: "medium" },
          regularMinor: "6000",
        },
        {
          commandId: "seed-demo-hoodie-heather-gray-large",
          name: "Dinkus Demo Everyday Hoodie",
          sku: "DEMO-HOSTED-HOODIE-HG-L",
          selections: { color: "heather-gray", size: "large" },
          regularMinor: "6000",
        },
      ],
    },
  },
  {
    commandId: "seed-demo-tote",
    name: "Dinkus Demo Canvas Tote",
    description: "A sturdy carryall for daily errands and market runs.",
    sku: "DEMO-HOSTED-TOTE",
    regularMinor: "2600",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-throw",
    name: "Dinkus Demo Woven Throw",
    description: "A soft woven layer for the sofa, reading chair, or bed.",
    sku: "DEMO-HOSTED-THROW",
    regularMinor: "4800",
    saleMinor: "4200",
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-tray",
    name: "Dinkus Demo Catchall Tray",
    description: "A compact tray for keys, glasses, and other small essentials.",
    sku: "DEMO-HOSTED-TRAY",
    regularMinor: "2200",
    saleMinor: null,
    availability: "in-stock",
  },
  {
    commandId: "seed-demo-socks",
    name: "Dinkus Demo Ribbed Socks",
    description: "A comfortable ribbed pair for everyday rotation.",
    sku: "DEMO-HOSTED-SOCKS",
    regularMinor: "1400",
    saleMinor: null,
    availability: "out-of-stock",
  },
  {
    commandId: "seed-demo-bottle",
    name: "Dinkus Demo Steel Bottle",
    description: "A simple insulated bottle sized for a day on the move.",
    sku: "DEMO-HOSTED-BOTTLE",
    regularMinor: "3000",
    saleMinor: null,
    availability: "in-stock",
  },
]);

export const DEMO_SKUS: ReadonlySet<string> = new Set([
  ...DEMO_PRODUCTS.map((product) => product.sku),
  ...DEMO_PRODUCTS.flatMap((product) => product.variant?.members.map((member) => member.sku) ?? []),
]);

/** Regular price for one demo SKU, including variant members. */
export function demoRegularMinorForSku(product: DemoProductSeed, sku: string): string {
  return product.variant?.members.find((member) => member.sku === sku.toUpperCase())?.regularMinor
    ?? product.regularMinor;
}

export function demoAvailabilityForSku(product: DemoProductSeed, sku: string): "in-stock" | "out-of-stock" {
  return product.variant?.members.find((member) => member.sku === sku.toUpperCase())?.availability
    ?? product.availability;
}

export function isDemoSku(sku: string): boolean {
  return DEMO_SKUS.has(sku.toUpperCase());
}

/** One Commerce variant member reference, as addCatalogVariantOption takes it. */
export type DemoVariantMemberInput =
  | { catalogItemId: string; fulfillment: "physical" }
  | {
    commandId: string;
    name: string;
    sku: string;
    fulfillment: "physical";
    selections: { optionId: string; valueId: string }[];
  };

/**
 * The addCatalogVariantOption input that adds option `optionIndex` of a demo
 * variant. Commerce adds options one at a time, so after option i the members
 * are those that use the first value of every later option. `existing` maps
 * the SKU of each member already created to its catalog item id.
 */
export function demoVariantOptionInput(
  product: DemoProductSeed,
  optionIndex: number,
  productId: string,
  existing: ReadonlyMap<string, string>,
  expectedRevision?: number,
) {
  const variant = product.variant;
  const option = variant?.options[optionIndex];
  if (!variant || !option) throw new Error(`Demo product ${product.sku} has no variant option ${optionIndex}.`);
  const later = variant.options.slice(optionIndex + 1);
  const present = variant.members.filter((member) =>
    later.every((next) => member.selections[next.optionId] === next.values[0]!.valueId));
  const reference = (member: (typeof variant.members)[number]): DemoVariantMemberInput => {
    const catalogItemId = member.sku === product.sku ? productId : existing.get(member.sku);
    if (catalogItemId) return { catalogItemId, fulfillment: "physical" };
    return {
      commandId: member.commandId,
      name: member.name,
      sku: member.sku,
      fulfillment: "physical",
      selections: variant.options.slice(0, optionIndex).map((earlier) => ({
        optionId: earlier.optionId,
        valueId: member.selections[earlier.optionId]!,
      })),
    };
  };
  return {
    productId,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    optionId: option.optionId,
    optionLabel: option.optionLabel,
    values: option.values.map((value) => {
      const members = present.filter((member) => member.selections[option.optionId] === value.valueId).map(reference);
      // The first option takes exactly one member per value, the product itself first.
      return optionIndex === 0
        ? { valueId: value.valueId, label: value.label, member: members[0]! }
        : { valueId: value.valueId, label: value.label, members };
    }),
  };
}
