import { OptionsRepository, getSiteSetting, setSiteSettings } from "emdash";

/**
 * Site visibility (GrillTrack template-site-visibility-20261122). EmDash 1.5
 * keeps a site in staging until someone presses Go live (Settings > General),
 * and that is the store's one search-engine switch. EmDash's own `EmDashHead`
 * asks search engines to stay away with `noindex, nofollow` while a site is in
 * staging; this store draws its own head, so it sends the same request as the
 * `X-Robots-Tag` header on every storefront response instead: pages, feeds and
 * JSON alike. EmDash's admin and API keep their own headers. Once the store is
 * Live, nothing here asks search engines to stay away.
 */
export const STAGING_ROBOTS = "noindex, nofollow";

/** EmDash's option for Settings > General > Site Status (`true` = staging). */
export const STAGING_OPTION = "site:staging";

/** Whether the site is still in staging. An unreadable setting counts as live. */
export async function siteIsStaging(): Promise<boolean> {
  try {
    return (await getSiteSetting("staging")) === true;
  } catch {
    return false;
  }
}

/** Whether a request path is the storefront rather than EmDash's own routes. */
export function isStorefrontPath(pathname: string): boolean {
  return !/^\/_emdash(?:\/|$)/iu.test(pathname);
}

/** The response with the staging robots header; a copy when its headers are read-only. */
export function withStagingRobots(response: Response): Response {
  try {
    response.headers.set("X-Robots-Tag", STAGING_ROBOTS);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set("X-Robots-Tag", STAGING_ROBOTS);
    return copy;
  }
}

/**
 * Storefront upgrade 007: a store that has never chosen staging or Live starts in
 * staging, as EmDash 1.5's setup starts a new site. Before 1.5 every store this
 * template builds was kept out of search engines, so an upgraded store stays out
 * until its owner presses Go live. A store whose owner already chose either way
 * keeps that choice.
 */
export async function startUndecidedStoreInStaging(db: unknown): Promise<void> {
  // Atomic, so an owner's choice saved meanwhile is never overwritten.
  if (!(await new OptionsRepository(db as never).setIfAbsent(STAGING_OPTION, true))) return;
  // Written the way EmDash writes it again, which refreshes its cached site settings.
  await setSiteSettings({ staging: true }, db as never);
}
