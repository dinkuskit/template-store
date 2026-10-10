// @ts-expect-error Cloudflare supplies this module in the Worker build.
import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { onRequest as emdashPlayground } from "@emdash-cms/cloudflare/db/playground-middleware";
import {
  checkPlaygroundCreationLimit,
  PLAYGROUND_CREATION_LIMITER_BINDING,
  PLAYGROUND_GLOBAL_LIMITER_BINDING,
} from "./features/playground/contract.js";

/**
 * Thin project-owned hook around EmDash's playground middleware.
 *
 * Infra-keeper should bind a Cloudflare Rate Limit binding named
 * PLAYGROUND_CREATION_LIMITER in the playground Worker. Local Wrangler runs
 * without the binding; when present, it limits only database initialization.
 */
export const onRequest = defineMiddleware(async (context, next) => {
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
