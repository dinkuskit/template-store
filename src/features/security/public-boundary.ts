export interface SecurityPolicyCheck {
  allowed: boolean;
  status: number;
  reason?: string;
}

const EXACT_ALLOWED_PATHS = new Set([
  "/",
  "/cart",
  "/cart/",
  "/favicon.ico",
  "/robots.txt",
  "/api/guest-cart/snapshot",
]);

const ALLOWED_PATH_PATTERNS = [
  /^\/_astro\/[^\s]+$/,
  /^\/merch\/[^\s]+$/,
  /^\/_emdash\/api\/media\/file\/[^\s]+$/,
  /^\/shop\/[a-zA-Z0-9_-]+$/,
  /^\/collections\/[a-zA-Z0-9_-]+$/,
  /^\/products\/[a-zA-Z0-9_-]+$/,
];

function decodedForms(value: string): string[] {
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

  // 2. Reject mutations and non-read HTTP methods (Public host is strictly read-only GET/HEAD)
  if (
    normalizedMethod === "POST" ||
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

  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    return {
      allowed: false,
      status: 405,
      reason: "Method not allowed.",
    };
  }

  const decodedPath = pathForms[pathForms.length - 1] ?? pathname;

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

export const PUBLIC_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

export function applySecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(PUBLIC_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
}
