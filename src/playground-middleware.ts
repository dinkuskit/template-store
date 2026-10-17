// @ts-expect-error Cloudflare supplies this module in the Worker build.
import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { onRequest as emdashPlayground } from "@emdash-cms/cloudflare/db/playground-middleware";
import {
  checkPlaygroundCreationLimit,
  PLAYGROUND_CREATION_LIMITER_BINDING,
  PLAYGROUND_GLOBAL_LIMITER_BINDING,
} from "./features/playground/contract.js";
import { PLAYGROUND_CHECKOUT_LIMITER_BINDING } from "./features/playground-checkout/index.js";

/**
 * Thin project-owned hook around EmDash's playground middleware.
 *
 * Infra-keeper should bind a Cloudflare Rate Limit binding named
 * PLAYGROUND_CREATION_LIMITER in the playground Worker. Local Wrangler runs
 * without the binding; when present, it limits only database initialization.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const runtimeEnv: Record<string, unknown> = {
    ...(process.env.DINKUS_LOCAL_PROOF === "1" ? process.env : {}),
    ...(env as Record<string, unknown>),
    ...(process.env.DINKUS_LOCAL_PROOF === "1" && process.env.DINKUS_LOCAL_PROOF_NOW
      ? { DINKUS_LOCAL_PROOF_NOW: process.env.DINKUS_LOCAL_PROOF_NOW }
      : {}),
  };
  (context.locals as { __playgroundEnv?: unknown }).__playgroundEnv = runtimeEnv;
  (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv = runtimeEnv;
  // Hand the sandbox checkout limiter binding to the store middleware, which
  // applies it to checkout starts before the per-visitor database is touched.
  (context.locals as { __playgroundCheckoutLimiter?: unknown }).__playgroundCheckoutLimiter =
    runtimeEnv[PLAYGROUND_CHECKOUT_LIMITER_BINDING];
  if (
    context.url.pathname === "/_playground/init" &&
    context.request.method === "POST"
  ) {
    const limiter = (env as Record<string, unknown>)[
      PLAYGROUND_CREATION_LIMITER_BINDING
    ] as Parameters<typeof checkPlaygroundCreationLimit>[1]["perIp"];
    const globalLimiter = (env as Record<string, unknown>)[
      PLAYGROUND_GLOBAL_LIMITER_BINDING
    ] as Parameters<typeof checkPlaygroundCreationLimit>[1]["global"];
    const limited = await checkPlaygroundCreationLimit(context.request, {
      perIp: limiter,
      global: globalLimiter,
    });
    if (limited) {
      return limited;
    }
  }

  const response = await emdashPlayground(context, next);
  return response ?? new Response(null, { status: 204 });
});
