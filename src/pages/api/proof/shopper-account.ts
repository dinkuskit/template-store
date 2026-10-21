import type { APIRoute } from "astro";

import { isProofMutationEnabled } from "../../../features/store-shell/index.js";
import {
  PRE_UPGRADE_SHOPPER_ORDER_ID,
  PRE_UPGRADE_SHOPPER_ORDER_NUMBER,
  ensurePreUpgradeShopperOrder,
  readCapturedProofEmail,
  readVerifiedPlaygroundLeads,
} from "../../../features/shopper-account/playground-runtime.js";

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const env =
    (locals as { __playgroundEnv?: Record<string, unknown> }).__playgroundEnv ??
    (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv ??
    process.env;
  if (!isProofMutationEnabled() && env.DINKUS_LOCAL_PROOF !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const email = url.searchParams.get("email")?.trim() ?? "";
  return Response.json({
    email: email ? readCapturedProofEmail(email) : null,
    leads: await readVerifiedPlaygroundLeads(env),
  });
};

export const POST: APIRoute = async ({ locals }) => {
  const env =
    (locals as { __playgroundEnv?: Record<string, unknown> }).__playgroundEnv ??
    (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv ??
    process.env;
  if (!isProofMutationEnabled() && env.DINKUS_LOCAL_PROOF !== "1") {
    return new Response("Not found", { status: 404 });
  }
  let db = (locals as { __playgroundDb?: Parameters<typeof ensurePreUpgradeShopperOrder>[0] }).__playgroundDb;
  if (!db) {
    const { getDb } = await import("emdash/runtime");
    db = (await getDb()) as Parameters<typeof ensurePreUpgradeShopperOrder>[0];
  }
  await ensurePreUpgradeShopperOrder(db);
  return Response.json({
    ok: true,
    preUpgradeOrderId: PRE_UPGRADE_SHOPPER_ORDER_ID,
    preUpgradeOrderNumber: PRE_UPGRADE_SHOPPER_ORDER_NUMBER,
  });
};
