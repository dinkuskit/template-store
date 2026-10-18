/** The EmDash menu the store header renders. The seed creates it. */
export const MAIN_MENU_NAME = "primary";

/** The resolved item shape `getMenu` returns. */
export interface StoreMenuItem {
  id: string;
  label: string;
  url: string;
  target?: string;
  titleAttr?: string;
  children: readonly StoreMenuItem[];
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
