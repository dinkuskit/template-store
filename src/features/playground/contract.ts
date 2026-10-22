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

/** Where a prospect goes to start a real DinkusKit store. */
export const START_REAL_STORE_URL = "https://dinkuskit.com/";
const EMDASH_DEPLOY_LINK =
  /(<a class="ec-pg-btn ec-pg-btn--deploy" href=")https:\/\/github\.com\/emdash-cms\/emdash("[^>]*>\s*)Deploy your own/;

/**
 * EmDash's playground toolbar ends with "Deploy your own", which opens the
 * plain EmDash repository. On our playground that button is the next step to
 * a real DinkusKit store (GrillTrack playground-prospect-demo-20261022).
 */
export function retargetPlaygroundDeployLink(html: string): string {
  return html.replace(EMDASH_DEPLOY_LINK, `$1${START_REAL_STORE_URL}$2Start your real store`);
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Tolerated clock skew between isolates for a just-minted session token. */
const SESSION_CLOCK_SKEW_MS = 60_000;

/** Milliseconds encoded in a ULID session token, or undefined when it is not one. */
export function playgroundSessionCreatedAt(token: string): number | undefined {
  if (!ULID_PATTERN.test(token)) return undefined;
  let time = 0;
  for (const char of token.slice(0, 10).toUpperCase()) {
    time = time * 32 + ULID_ALPHABET.indexOf(char);
  }
  return time;
}

/**
 * EmDash mints the session as a ULID and its Durable Object drops every table
 * when the TTL alarm fires. A token that is not a ULID, or whose store has
 * outlived the TTL, cannot point at a usable store, so it must start over.
 */
export function isUsablePlaygroundSession(token: string, now = Date.now()): boolean {
  const createdAt = playgroundSessionCreatedAt(token);
  if (createdAt === undefined) return false;
  return (
    createdAt <= now + SESSION_CLOCK_SKEW_MS &&
    now - createdAt < PLAYGROUND_TTL_SECONDS * 1000
  );
}

export function readPlaygroundSession(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === PLAYGROUND_COOKIE_NAME) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

/** The same request without the playground session cookie. */
export function withoutPlaygroundSession(request: Request): Request {
  const header = request.headers.get("cookie") ?? "";
  const kept = header
    .split(";")
    .filter((part) => part.split("=")[0]?.trim() !== PLAYGROUND_COOKIE_NAME)
    .join(";")
    .trim();
  const headers = new Headers(request.headers);
  if (kept) headers.set("cookie", kept);
  else headers.delete("cookie");
  return new Request(request, { headers });
}

export const CLEAR_PLAYGROUND_COOKIE =
  `${PLAYGROUND_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

export async function isPlaygroundInitFailure(response: Response): Promise<boolean> {
  if (response.status !== 500) return false;
  if (!response.headers.get("content-type")?.includes("application/json")) return false;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return body?.error?.code === "PLAYGROUND_INIT_ERROR";
  } catch {
    return false;
  }
}

const PLAYGROUND_INIT_FAILED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex, nofollow" /><title>Playground unavailable</title></head>
<body><h1>The playground couldn't start</h1><p><a href="/playground">Try again</a></p></body></html>`;

/**
 * A session whose store failed to initialize (for example an init cut off
 * part-way through its migrations) fails again on every request. Drop the
 * cookie so the visitor gets a fresh store instead of a permanent 500.
 */
export function recoverFromPlaygroundInitFailure(
  request: Request,
  failure: Response,
): Response {
  if (request.method === "GET" || request.method === "HEAD") {
    // One retry only: a fresh session that fails init again would loop.
    if (new URL(request.url).searchParams.get("retry") === "1") {
      return new Response(PLAYGROUND_INIT_FAILED_HTML, {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": CLEAR_PLAYGROUND_COOKIE,
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/playground?retry=1",
        "Set-Cookie": CLEAR_PLAYGROUND_COOKIE,
        "Cache-Control": "no-store",
      },
    });
  }
  const headers = new Headers(failure.headers);
  headers.append("Set-Cookie", CLEAR_PLAYGROUND_COOKIE);
  headers.set("Cache-Control", "no-store");
  return new Response(failure.body, { status: failure.status, headers });
}
