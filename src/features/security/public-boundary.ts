export interface SecurityPolicyCheck {
  allowed: boolean;
  status: number;
  reason?: string;
}

const EXACT_ALLOWED_PATHS = new Set([
  "/",
  "/home",
  "/cart",
  "/checkout/success",
  "/checkout/cancel",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/api/guest-cart/snapshot",
]);

const ALLOWED_PATH_PATTERNS = [
  /^\/sitemap-[a-z0-9-]+\.xml$/,
  /^\/_astro\/[^\s]+$/,
  /^\/merch\/[^\s]+$/,
  /^\/_emdash\/api\/media\/file\/[^\s]+$/,
  /^\/shop\/[a-zA-Z0-9_-]+$/,
  /^\/collections\/[a-zA-Z0-9_-]+$/,
  /^\/products\/[a-zA-Z0-9_-]+$/,
];

const GUEST_CHECKOUT_POST_PATH =
  /^\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/(prepare|start|status)$/;
const COMMERCE_IMAGE_HREF_PATH = /^\/_emdash\/api\/media\/file\/([A-Za-z0-9._-]+)$/;
const SLASHLESS_REDIRECTS = new Map([
  ["/cart/", "/cart"],
  ["/checkout/success/", "/checkout/success"],
  ["/checkout/cancel/", "/checkout/cancel"],
]);

function slashlessCollectionPath(pathname: string): string | undefined {
  if (!pathname.endsWith("/") || pathname === "/") return undefined;
  if (/^\/(?:products|collections|shop)\/[^/]+\/$/.test(pathname)) {
    return pathname.slice(0, -1);
  }
  return undefined;
}

export function decodedForms(value: string): string[] {
  const forms = [value];
  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeURIComponent(current);
    if (next === current) break;
    forms.push(next);
    current = next;
  }
  return forms;
}

export function isExactGuestCheckoutPath(pathname: string): boolean {
  try {
    return decodedForms(pathname).some((path) => GUEST_CHECKOUT_POST_PATH.test(path));
  } catch {
    return false;
  }
}

export function slashlessRedirectPath(pathname: string): string | undefined {
  return SLASHLESS_REDIRECTS.get(pathname) ?? slashlessCollectionPath(pathname);
}

function isDisallowedTraversalOrTarget(pathname: string, search: string): boolean {
  // Check raw percent-encoded dots or null bytes
  if (/%2e/i.test(pathname) || /%2e/i.test(search) || /%00/i.test(pathname) || /%00/i.test(search)) {
    return true;
  }

  // Check path traversal sequences
  if (pathname.includes("/..") || pathname.includes("/./") || pathname.includes("//")) {
    return true;
  }

  // Check for administrative, bypass, or sensitive targets in path or query
  const lowerPath = pathname.toLowerCase();
  const lowerSearch = search.toLowerCase();

  if (
    lowerPath.includes("dev-bypass") ||
    lowerSearch.includes("dev-bypass") ||
    lowerPath.includes("admin") ||
    lowerSearch.includes("admin") ||
    lowerPath.includes("setup") ||
    lowerSearch.includes("setup") ||
    lowerPath.includes("%61dmin") ||
    lowerPath.includes("%64ev-bypass") ||
    lowerPath.startsWith("/api/proof") ||
    lowerPath.startsWith("/_emdash/api/auth") ||
    lowerPath.startsWith("/api/auth") ||
    lowerPath.startsWith("/_emdash/api/schema") ||
    lowerPath.startsWith("/api/schema")
  ) {
    return true;
  }

  return false;
}

/** Same-host EmDash media file transformed by `/_image`. Not an open proxy. */
export function isSafeCommerceImageRequest(search: string, requestHref?: string): boolean {
  if (!requestHref) return false;
  let requestUrl: URL;
  let params: URLSearchParams;
  try {
    requestUrl = new URL(requestHref);
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return false;
  }
  const names = [...params.keys()];
  if (names.length !== 3 || names.some((name) => name !== "href" && name !== "w" && name !== "f")) return false;
  if (params.getAll("href").length !== 1 || params.getAll("w").length !== 1 || params.getAll("f").length !== 1) return false;
  if (params.get("f") !== "webp") return false;
  const width = params.get("w") ?? "";
  if (!/^[1-9]\d{0,3}$/.test(width) || Number(width) > 2048) return false;
  let href: URL;
  try {
    href = new URL(params.get("href") ?? "");
  } catch {
    return false;
  }
  if (href.username || href.password || href.search || href.hash) return false;
  if (href.protocol !== requestUrl.protocol || href.host !== requestUrl.host) return false;
  return COMMERCE_IMAGE_HREF_PATH.test(href.pathname);
}

export function evaluatePublicBoundary(
  method: string,
  pathname: string,
  search: string = "",
  requestHref?: string,
): SecurityPolicyCheck {
  const normalizedMethod = method.toUpperCase();

  let pathForms: string[];
  let searchForms: string[];
  try {
    pathForms = decodedForms(pathname);
    searchForms = decodedForms(search);
  } catch {
    return {
      allowed: false,
      status: 403,
      reason: "Invalid URI encoding.",
    };
  }

  // 1. Fail-closed against path traversal, dev-bypass, or administrative endpoints,
  // including percent-encoded and double-encoded forms.
  for (const pathForm of pathForms) {
    for (const searchForm of searchForms) {
      if (isDisallowedTraversalOrTarget(pathForm, searchForm)) {
        return {
          allowed: false,
          status: 403,
          reason: "Access to administrative, internal, or traversal paths is forbidden.",
        };
      }
    }
  }

  const isGuestCheckoutPost = pathForms.some((path) => GUEST_CHECKOUT_POST_PATH.test(path));

  // 2. Reject mutations and non-read HTTP methods, except the three exact
  // Commerce guest POSTs admitted below.
  if (
    (normalizedMethod === "POST" && !isGuestCheckoutPost) ||
    normalizedMethod === "PUT" ||
    normalizedMethod === "PATCH" ||
    normalizedMethod === "DELETE"
  ) {
    return {
      allowed: false,
      status: 405,
      reason: "Mutations are not permitted on the public demo host.",
    };
  }

  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && !isGuestCheckoutPost) {
    return {
      allowed: false,
      status: 405,
      reason: "Method not allowed.",
    };
  }

  const decodedPath = pathForms[pathForms.length - 1] ?? pathname;

  if (GUEST_CHECKOUT_POST_PATH.test(decodedPath)) {
    if (normalizedMethod !== "POST") {
      return { allowed: false, status: 405, reason: "Method not allowed." };
    }
    return { allowed: true, status: 200 };
  }

  // 3. Validate the canonical decoded path against the strict route allowlist
  if (EXACT_ALLOWED_PATHS.has(decodedPath)) {
    return { allowed: true, status: 200 };
  }

  for (const pattern of ALLOWED_PATH_PATTERNS) {
    if (pattern.test(decodedPath)) {
      return { allowed: true, status: 200 };
    }
  }

  if (decodedPath === "/_image" && searchForms.some((form) => isSafeCommerceImageRequest(form, requestHref))) {
    return { allowed: true, status: 200 };
  }

  // 4. Any route not explicitly in the allowlist is rejected
  return {
    allowed: false,
    status: 404,
    reason: "Route not found.",
  };
}

export function demoNoIndexEnabled(
  env: Record<string, unknown> = process.env,
): boolean {
  // Search visibility is not access protection. A real merchant launch must
  // explicitly opt in; demos, previews, and staging are private to crawlers.
  return env.DINKUS_LAUNCH_INDEXABLE !== "1";
}

export function applySecurityHeaders(
  headers: Headers,
  env: Record<string, unknown> = process.env,
): void {
  const securityHeaders: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (demoNoIndexEnabled(env)) {
    securityHeaders["X-Robots-Tag"] = "noindex, nofollow";
  }
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }
}
