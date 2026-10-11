import type { APIRoute } from "astro";

import {
  COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
  parseGuestCheckoutWireResult,
} from "../../../features/guest-cart/checkout-protocol.js";

export const prerender = false;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

function unavailable(status = 503): Response {
  return Response.json(
    { ok: false, error: { code: "CHECKOUT_UNAVAILABLE", message: "Checkout status unavailable." } },
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
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) return null;
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

export const POST: APIRoute = async ({ request }) => {
  const requestBody = await boundedRequestText(request);
  if (requestBody === null) {
    return unavailable(413);
  }
  const capability = request.headers.get(GUEST_CHECKOUT_CAPABILITY_HEADER);
  if (!capability) {
    return unavailable(400);
  }
  try {
    // This self-fetch targets Commerce's distinct public route, not this proxy,
    // so the Worker route boundary cannot recurse. Wrangler coverage exercises it.
    const target = new URL(COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT, request.url);
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [GUEST_CHECKOUT_CAPABILITY_HEADER]: capability,
      },
      body: requestBody,
      cache: "no-store",
    });
    if (!upstream.ok || !(upstream.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return unavailable();
    }
    const body = await boundedText(upstream);
    if (body === null) return unavailable();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return unavailable();
    }
    const validated = parseGuestCheckoutWireResult(parsed);
    if (!validated || !validated.ok) return unavailable();
    return Response.json(parsed, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
};
