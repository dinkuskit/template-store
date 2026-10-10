/** Public contract for the disposable TemplateStore playground. */
export const PLAYGROUND_COOKIE_NAME = "emdash_playground";
export const PLAYGROUND_TTL_SECONDS = 60 * 60;
export const PLAYGROUND_ADMIN_ID = "playground-admin";
export const PLAYGROUND_CREATION_LIMITER_BINDING = "PLAYGROUND_CREATION_LIMITER";
export const PLAYGROUND_GLOBAL_LIMITER_BINDING = "PLAYGROUND_GLOBAL_LIMITER";

export type PlaygroundLimiters = {
  perIp?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  global?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

export async function checkPlaygroundCreationLimit(
  request: Request,
  limiters: PlaygroundLimiters,
): Promise<Response | undefined> {
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (
    limiters.perIp &&
    !(await limiters.perIp.limit({
      key: `template-store:playground:create:ip:${clientIp}`,
    })).success
  ) {
    return new Response(
      "Too many playground databases requested from this IP. Please try again later.",
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
    );
  }

  if (
    limiters.global &&
    !(await limiters.global.limit({
      key: "template-store:playground:create:global",
    })).success
  ) {
    return new Response(
      "The playground is busy creating databases. Please try again shortly.",
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
    );
  }

  return undefined;
}

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
