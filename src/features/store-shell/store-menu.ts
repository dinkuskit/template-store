/** The EmDash menu the store header renders. The seed creates it. */
export const MAIN_MENU_NAME = "primary";

/** The EmDash menus the shared store footer renders. */
export const FOOTER_SHOP_MENU_NAME = "footer_shop";
export const FOOTER_POLICIES_MENU_NAME = "footer_policies";

export const THEME_COOKIE_NAME = "dinkus_theme";
export const PRESET_COOKIE_NAME = "dinkus_preset";

export const STORE_THEMES = ["light", "dark", "system"] as const;
export type StoreThemeMode = (typeof STORE_THEMES)[number];

export const STORE_PRESETS = ["aizome", "forest", "cobalt"] as const;
export type StorePresetName = (typeof STORE_PRESETS)[number];

export const POLICY_SUPPORT_SECTION_SLUG = "policy-support-note";

/** The resolved item shape `getMenu` returns. */
export interface StoreMenuItem {
  id: string;
  label: string;
  url: string;
  target?: string;
  titleAttr?: string;
  children: readonly StoreMenuItem[];
}

export const FALLBACK_FOOTER_SHOP_LINKS: readonly Pick<StoreMenuItem, "label" | "url">[] = [
  { label: "All products", url: "/#commerce-catalog" },
];

export const FALLBACK_FOOTER_POLICIES_LINKS: readonly Pick<StoreMenuItem, "label" | "url">[] = [
  { label: "Shipping", url: "/shipping" },
  { label: "Returns", url: "/returns" },
  { label: "Account", url: "/account" },
  { label: "Shopping bag", url: "/cart" },
  { label: "Search", url: "/search" },
];

export function isStoreThemeMode(value: unknown): value is StoreThemeMode {
  return typeof value === "string" && (STORE_THEMES as readonly string[]).includes(value);
}

export function isStorePresetName(value: unknown): value is StorePresetName {
  return typeof value === "string" && (STORE_PRESETS as readonly string[]).includes(value);
}

/**
 * True when the item links to the page being rendered. Fragment links
 * ("/#commerce-catalog") jump within a page and never mark it current.
 */
export function isCurrentMenuItem(item: Pick<StoreMenuItem, "url">, pathname: string): boolean {
  if (!item.url.startsWith("/") || item.url.startsWith("//") || /[#?]/u.test(item.url)) return false;
  const trim = (value: string) => (value.length > 1 ? value.replace(/\/+$/u, "") : value);
  return trim(item.url) === trim(pathname);
}
