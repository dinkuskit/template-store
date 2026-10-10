/** Public contract for the disposable TemplateStore playground. */
export const PLAYGROUND_COOKIE_NAME = "emdash_playground";
export const PLAYGROUND_TTL_SECONDS = 60 * 60;
export const PLAYGROUND_ADMIN_ID = "playground-admin";
export const PLAYGROUND_CREATION_LIMITER_BINDING = "PLAYGROUND_CREATION_LIMITER";

/**
 * The cookie is an opaque visitor session, never an identity or an authority.
 * The DO namespace hashes this value into a private SQLite instance.
 */
export function playgroundDatabaseKey(sessionToken: string): string {
  return `template-store:${sessionToken}`;
}

export function applyPlaygroundNoIndex(headers: Headers): void {
  headers.set("X-Robots-Tag", "noindex, nofollow");
}

/** A rewritten HTML body no longer matches the upstream length or validator. */
export function dropRewrittenBodyHeaders(headers: Headers): void {
  headers.delete("Content-Length");
  headers.delete("ETag");
}

export function injectPlaygroundNoIndex(html: string): string {
  if (/<meta\s+name=["']robots["']/i.test(html)) return html;
  return html.replace(
    /<head(\s[^>]*)?>/i,
    (head) => `${head}<meta name="robots" content="noindex, nofollow" />`,
  );
}
