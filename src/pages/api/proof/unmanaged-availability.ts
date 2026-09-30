import type { APIRoute } from "astro";

import { isProofMutationEnabled } from "../../../features/store-shell/index.js";
import { UnmanagedProductSellabilityError } from "../../../features/unmanaged-product-sellability/errors.js";
import {
  UNMANAGED_PRODUCT_ITEM_ID,
  type UnmanagedAvailabilityProof,
} from "../../../features/unmanaged-product-sellability/types.js";

export const prerender = false;

function isAvailabilityProof(value: unknown): value is UnmanagedAvailabilityProof {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.catalogItemId === UNMANAGED_PRODUCT_ITEM_ID &&
    (record.status === "in-stock" ||
      record.status === "out-of-stock" ||
      record.status === "available-on-backorder")
  );
}

export const POST: APIRoute = async ({ request }) => {
  if (!isProofMutationEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isAvailabilityProof(body)) {
    return Response.json({ error: "invalid_availability" }, { status: 400 });
  }

  const { unmanagedProductSellabilityRuntime } = await import(
    "../../../features/unmanaged-product-sellability/index.js"
  );
  try {
    const availability = await unmanagedProductSellabilityRuntime.setAvailability(
      body,
    );
    return Response.json({ availability });
  } catch (error) {
    if (error instanceof UnmanagedProductSellabilityError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
};
