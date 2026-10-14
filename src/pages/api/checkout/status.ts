import type { APIRoute } from "astro";

import {
  COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
  parseGuestCheckoutWireResult,
} from "../../../features/guest-cart/checkout-protocol.js";

export const prerender = false;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_DISCARD_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

type StatusFailureCode =
  | "CHECKOUT_UNAVAILABLE"
  | "CHECKOUT_STATUS_HOST_ORIGIN"
  | "CHECKOUT_STATUS_ORIGIN_DENIED"
  | "CHECKOUT_STATUS_CAPABILITY_DENIED"
  | "CHECKOUT_STATUS_NOT_FOUND"
  | "CHECKOUT_STATUS_UNAVAILABLE"
  | "CHECKOUT_STATUS_UPSTREAM_REDIRECT"
  | "CHECKOUT_STATUS_UPSTREAM_HTTP"
  | "CHECKOUT_STATUS_RESPONSE_INVALID"
  | "CHECKOUT_STATUS_FETCH_FAILED";

function domainFailureCode(code: string): StatusFailureCode {
  switch (code) {
    case "ORIGIN_DENIED": return "CHECKOUT_STATUS_ORIGIN_DENIED";
    case "CAPABILITY_DENIED": return "CHECKOUT_STATUS_CAPABILITY_DENIED";
    case "CHECKOUT_NOT_FOUND": return "CHECKOUT_STATUS_NOT_FOUND";
    case "UNAVAILABLE":
    case "PAYMENTS_UNAVAILABLE": return "CHECKOUT_STATUS_UNAVAILABLE";
    default: return "CHECKOUT_UNAVAILABLE";
  }
}

function unavailable(status = 503, code: StatusFailureCode = "CHECKOUT_UNAVAILABLE"): Response {
  return Response.json(
    { ok: false, error: { code, message: "Checkout status unavailable." } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function boundedText(response: Response): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) return null;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MAX_RESPONSE_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function boundedRequestText(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    await discardRequestBody(request);
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        // Drain instead of cancelling: cancelling a chunked request body mid-stream
        // makes workerd drop the connection, so the client sees a 500 "Network
        // connection lost" instead of our 413. Draining is capped at 64 KiB
        // (MAX_DISCARD_BYTES) so an oversized or endless body cannot hold the
        // Worker reading forever; past that cap we stop reading and still reply 413.
        while (size <= MAX_DISCARD_BYTES) {
          const extra = await reader.read();
          if (extra.done) break;
          size += extra.value.byteLength;
        }
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function discardRequestBody(request: Request): Promise<void> {
  if (!request.body) return;
  const reader = request.body.getReader();
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      size += next.value.byteLength;
      if (size > MAX_DISCARD_BYTES) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // The body may already be disconnected; the bounded response is still safe.
  } finally {
    reader.releaseLock();
  }
}

// Do not turn this proxy into a same-origin credential forwarder for foreign
// callers. The configured store origin is authority; request Host is not.
function trustedStatusOrigin(request: Request): string | null {
  try {
    const site = new URL(process.env.EMDASH_SITE_URL ?? "");
    const origin = new URL(request.headers.get("origin") ?? "");
    const canonical = (url: URL) =>
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
    if (!canonical(site) || !canonical(origin) || origin.origin !== site.origin ||
        new URL(request.url).origin !== site.origin) return null;
    const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
    if (fetchSite !== undefined && fetchSite !== "same-origin") return null;
    return site.origin;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const requestBody = await boundedRequestText(request);
  if (requestBody === null) {
    return unavailable(413);
  }
  const capability = request.headers.get(GUEST_CHECKOUT_CAPABILITY_HEADER);
  if (!capability) {
    return unavailable(400);
  }
  const origin = trustedStatusOrigin(request);
  if (!origin) return unavailable(403, "CHECKOUT_STATUS_HOST_ORIGIN");
  try {
    // This self-fetch targets Commerce's distinct public route, not this proxy,
    // so the Worker route boundary cannot recurse. Wrangler coverage exercises it.
    const target = new URL(COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT, origin);
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin,
        [GUEST_CHECKOUT_CAPABILITY_HEADER]: capability,
      },
      body: requestBody,
      cache: "no-store",
      // Workers supports manual/follow only. Keep redirects visible here so
      // the non-2xx check below rejects them without forwarding credentials.
      redirect: "manual",
    });
    if (!upstream.ok) {
      return unavailable(503, upstream.status >= 300 && upstream.status < 400
        ? "CHECKOUT_STATUS_UPSTREAM_REDIRECT" : "CHECKOUT_STATUS_UPSTREAM_HTTP");
    }
    if (!(upstream.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    }
    const body = await boundedText(upstream);
    if (body === null) return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    }
    const validated = parseGuestCheckoutWireResult(parsed);
    if (!validated) return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    if (!validated.ok) return unavailable(503, domainFailureCode(validated.error.code));
    return Response.json(parsed, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503, "CHECKOUT_STATUS_FETCH_FAILED");
  }
};
