export const STORE_TITLE = "DinkusKit Store Starter";
export const STORE_DESCRIPTION =
  "A neutral proof storefront for EmDash, DinkusKit Blocks, Commerce, and Inventory.";
export {
  formatUsdMinor,
  presentStorefrontPrice,
  type PublicPriceView,
} from "./price.js";
export {
  STOREFRONT_PROFILE_PROOF,
  STOREFRONT_PROFILE_SHIPPING,
  isProofMutationEnabled,
  isProofStorefrontProfile,
  readStorefrontProfile,
  type StorefrontProfile,
} from "./profile.js";
export {
  readProofDemonstrations,
  type ProofDemonstrations,
} from "./proof-demonstrations.js";
export {
  loadStorefrontRouteContext,
  type StorefrontRouteContext,
} from "./storefront-route.js";
export {
  buildMerchCollections,
  publicMerchCollections,
  categoryAnchor,
  collectionPath,
  productPath,
  type MerchCollection,
  type MerchRecord,
} from "./merch-catalog.js";
