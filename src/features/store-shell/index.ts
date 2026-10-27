export const STORE_TITLE = "DinkusKit Store Starter";
export const STORE_DESCRIPTION =
  "A neutral storefront for EmDash and Commerce.";
export const PROOF_STORE_DESCRIPTION =
  "A neutral proof storefront for EmDash, Commerce, and Inventory.";
export {
  formatUsdMinor,
  presentStorefrontPrice,
  type PublicPriceView,
} from "./price.js";
export {
  PROOF_DEMONSTRATIONS_PATH,
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
  categoryPath,
  collectionPath,
  productPath,
  type MerchCollection,
  type MerchRecord,
} from "./merch-catalog.js";
export {
  MAIN_MENU_NAME,
  FOOTER_SHOP_MENU_NAME,
  FOOTER_POLICIES_MENU_NAME,
  THEME_COOKIE_NAME,
  PRESET_COOKIE_NAME,
  STORE_THEMES,
  STORE_PRESETS,
  POLICY_SUPPORT_SECTION_SLUG,
  FALLBACK_FOOTER_SHOP_LINKS,
  FALLBACK_FOOTER_POLICIES_LINKS,
  isStoreThemeMode,
  isStorePresetName,
  isCurrentMenuItem,
  type StoreMenuItem,
  type StoreThemeMode,
  type StorePresetName,
} from "./store-menu.js";
export {
  STOREFRONT_SEARCHABLE_COLLECTIONS,
  ensureStorefrontSearchSupport,
} from "./search-upgrade.js";
export { ensureStorefrontPageAddresses, ensureStorefrontProductFields } from "./product-schema-upgrade.js";
export {
  renderHighlightedSnippetParts,
  isSearchProductVisibleOnStorefront,
  filterStorefrontSearchHits,
  filterPublicSearchApiResponse,
  loadVisibleStorefrontProductSlugs,
  type HighlightedSnippetPart,
  type SearchProductVisibilityOptions,
} from "./search-visibility.js";
