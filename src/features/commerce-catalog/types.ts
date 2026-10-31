import type { StorefrontAvailabilityResult } from "@dinkuskit/commerce";
import type { PublicPriceView } from "../store-shell/price.js";
import type { PublicCommerceImage } from "./media.js";

export const PUBLIC_FEED_CHANNELS = ["google-merchant", "meta-catalog"] as const;
export type PublicFeedChannel = (typeof PUBLIC_FEED_CHANNELS)[number];

export interface PublicCommerceProduct {
  id: string;
  name: string;
  sku: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  /**
   * Present only when the public catalog payload included `feedChannels`.
   * Absence is not the same as an empty opt-in list.
   */
  feedChannels?: readonly PublicFeedChannel[];
  fulfillment?: "physical" | "digital";
  price: PublicPriceView;
  availability: Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">;
  image: PublicCommerceImage | null;
  gallery: readonly PublicCommerceImage[];
  /** Server-projected variant members (e.g. sizes/colors); absent for simple items. */
  variants?: readonly PublicCommerceVariant[];
  /**
   * The entry id of the product page that sells it, which Commerce keeps
   * (template-no-commerce-box-20261029); absent before a publish check records one.
   */
  page?: string;
}

export interface PublicCommerceVariant {
  id: string;
  /** Option label to value label, e.g. [["Size", "Small"]]. */
  selections: readonly (readonly [string, string])[];
  unitMinor: string;
  priceText: string;
  availability: Pick<StorefrontAvailabilityResult, "status" | "sellable">;
  /** The member's own fulfillment as Commerce projects it; absent when Commerce sends none or an unknown value. */
  fulfillment?: "physical" | "digital";
}
