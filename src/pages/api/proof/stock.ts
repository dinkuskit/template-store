import type { APIRoute } from "astro";

import {
  ManagedProductAvailabilityError,
  managedProductAvailabilityRuntime,
  type StockProofAdjustment,
} from "../../../features/managed-product-availability/index.js";

export const prerender = false;

function isProofAdjustment(value: unknown): value is StockProofAdjustment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    typeof record.commandId === "string" &&
    (record.delta === "-3" || record.delta === "3") &&
    (record.reason === "proof-change" || record.reason === "proof-restore")
  );
}

export const POST: APIRoute = async ({ request }) => {
  if (process.env.DINKUS_PROOF_MODE !== "1") {
    return new Response("Not found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isProofAdjustment(body)) {
    return Response.json({ error: "invalid_adjustment" }, { status: 400 });
  }

  try {
    const availability = await managedProductAvailabilityRuntime.adjust(body);
    return Response.json({ availability });
  } catch (error) {
    if (error instanceof ManagedProductAvailabilityError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
};
