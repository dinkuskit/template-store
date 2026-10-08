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
const SLASHLESS_REDIRECTS = new Map([
  ["/cart/", "/cart"],
  ["/checkout/success/", "/checkout/success"],
  ["/checkout/cancel/", "/checkout/cancel"],
]);

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
  return SLASHLESS_REDIRECTS.get(pathname);
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

export function evaluatePublicBoundary(
  method: string,
  pathname: string,
  search: string = "",
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
  const demoNoIndex = typeof env.DINKUS_DEMO_NOINDEX === "string"
    ? env.DINKUS_DEMO_NOINDEX
    : undefined;
  const profile = typeof env.DINKUS_STOREFRONT_PROFILE === "string"
    ? env.DINKUS_STOREFRONT_PROFILE
    : undefined;
  return demoNoIndex === "1" || profile?.trim().toLowerCase() === "proof";
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
