import type { APIRoute } from "astro";

import {
  COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT,
  COMMERCE_REGISTRY_RUNTIME_ID,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
  parseGuestCheckoutWireResult,
} from "../../../features/guest-cart/checkout-protocol.js";

import { canDispatchInstalledGuestCheckout } from "../../../features/guest-cart/checkout-admission.js";
import { NATIVE_COMMERCE_PLUGIN_ID, nativeCheckoutPath, visitorIp } from "../../../features/playground-checkout/index.js";
import { playgroundCheckoutConfigured, withCheckoutVisitor } from "../../../features/playground-checkout/payments-port.js";

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
  | "CHECKOUT_STATUS_RESPONSE_INVALID";

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

/**
 * A configured playground session serves guest checkout from its own native
 * Commerce plugin (per-visitor runtime), not the Registry install, so status
 * recovery dispatches there. Capability and origin checks above still apply.
 */
function playgroundNativeStatus(locals: unknown): boolean {
  return Boolean((locals as { __playgroundDb?: unknown } | undefined)?.__playgroundDb) &&
    playgroundCheckoutConfigured();
}

export const POST: APIRoute = async ({ request, locals }) => {
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
  const runtime = locals?.emdash;
  if (!runtime || typeof runtime.handlePublicPluginApiRoute !== "function") {
    return unavailable(503, "CHECKOUT_STATUS_UNAVAILABLE");
  }
  try {
    const native = playgroundNativeStatus(locals);
    if (!native && !canDispatchInstalledGuestCheckout({ runtime, request })) {
      return unavailable(503, "CHECKOUT_STATUS_UNAVAILABLE");
    }
    const pluginId = native ? NATIVE_COMMERCE_PLUGIN_ID : COMMERCE_REGISTRY_RUNTIME_ID;
    const target = native
      ? new URL(nativeCheckoutPath("status"), origin)
      : new URL(COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT, origin);
    const dispatch = () => runtime.handlePublicPluginApiRoute(
      pluginId,
      "POST",
      "checkout/guest/status",
      new Request(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          origin,
          [GUEST_CHECKOUT_CAPABILITY_HEADER]: capability,
        },
        body: requestBody,
        cache: "no-store",
      }),
    );
    // Payments lookups from the native playground port require the exact
    // playground session that owns the disposable Commerce runtime.
    const session = /(?:^|;\s*)emdash_playground=([A-Za-z0-9._~-]{1,512})(?:;|$)/u.exec(
      request.headers.get("cookie") ?? "",
    )?.[1] ?? "";
    const result = native
      ? await withCheckoutVisitor(visitorIp(request) ?? "", session, dispatch)
      : await dispatch();
    let parsed: unknown;
    try {
      const text = JSON.stringify(result);
      if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
      }
      parsed = JSON.parse(text);
    } catch {
      return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    }
    const validated = parseGuestCheckoutWireResult(parsed);
    if (!validated) return unavailable(503, "CHECKOUT_STATUS_RESPONSE_INVALID");
    if (!validated.ok) return unavailable(503, domainFailureCode(validated.error.code));
    const { schema, state, attemptId, redirectUrl, order, retryAfter } = validated.checkout;
    return Response.json({
      ok: true,
      capabilityId: validated.capabilityId,
      checkout: { schema, state, attemptId, redirectUrl, order, retryAfter },
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503, "CHECKOUT_STATUS_UNAVAILABLE");
  }
};
