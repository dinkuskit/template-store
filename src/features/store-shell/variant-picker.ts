/**
 * Product page variant pickers: one picker per Commerce option. Browser-safe
 * and pure, so the page script and unit tests share the same matching rules.
 */

export interface VariantPickerMember {
  id: string;
  /** Option label to value label, e.g. { Color: "Black", Size: "Small" }. */
  values: Record<string, string>;
  price: string;
  availability: string;
  status: string;
  sellable: boolean;
}

export interface VariantPickerView {
  /** The matching member, or null when that combination does not exist. */
  member: VariantPickerMember | null;
  /** Price to show; null hides the price because nothing can be bought. */
  price: string | null;
  status: string;
  availability: string;
  sellable: boolean;
  buttonLabel: "Add to cart" | "Sold out" | "Unavailable";
  /** Option label to value label to sold out, for striking values through. */
  soldOut: Record<string, Record<string, boolean>>;
}

/** Key for the server-prepared Product JSON-LD that carries no Offer. */
export const NO_OFFER_JSON_LD_KEY = "no-offer";

function matches(member: VariantPickerMember, picked: Readonly<Record<string, string>>): boolean {
  return Object.entries(member.values).every(([option, value]) => picked[option] === value);
}

export function variantPickerView(
  members: readonly VariantPickerMember[],
  picked: Readonly<Record<string, string>>,
): VariantPickerView {
  const member = members.find((candidate) => matches(candidate, picked)) ?? null;
  const soldOut: Record<string, Record<string, boolean>> = {};
  for (const candidate of members) {
    for (const [option, value] of Object.entries(candidate.values)) {
      soldOut[option] ??= {};
      // A value is sold out when no sellable member has it beside the other picked values.
      soldOut[option][value] = !members.some((other) =>
        other.sellable && matches(other, { ...picked, [option]: value }));
    }
  }
  return {
    member,
    price: member?.price ?? null,
    status: member?.status ?? "Unavailable",
    availability: member?.availability ?? "",
    sellable: Boolean(member?.sellable),
    buttonLabel: member?.sellable ? "Add to cart" : member ? "Sold out" : "Unavailable",
    soldOut,
  };
}
