import type { APIRoute } from "astro";

import {
  COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
} from "../../../features/guest-cart/checkout-protocol.js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const capability = request.headers.get(GUEST_CHECKOUT_CAPABILITY_HEADER);
  if (!capability) {
    return Response.json({ ok: false, error: { code: "CAPABILITY_REQUIRED", message: "Checkout capability required." } }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const target = new URL(COMMERCE_GUEST_CHECKOUT_STATUS_ENDPOINT, request.url);
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [GUEST_CHECKOUT_CAPABILITY_HEADER]: capability,
      },
      body: await request.text(),
      cache: "no-store",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ ok: false, error: { code: "CHECKOUT_UNAVAILABLE", message: "Checkout status unavailable." } }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
};
