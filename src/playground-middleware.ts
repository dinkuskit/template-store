// @ts-expect-error Cloudflare supplies this module in the Worker build.
import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { onRequest as emdashPlayground } from "@emdash-cms/cloudflare/db/playground-middleware";
import {
  PLAYGROUND_CREATION_LIMITER_BINDING,
} from "./features/playground/contract.js";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

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
    ] as RateLimiter | undefined;
    if (limiter) {
      const clientIp = context.request.headers.get("cf-connecting-ip") ?? "local";
      const result = await limiter.limit({
        key: `template-store:playground:create:${clientIp}`,
      });
      if (!result.success) {
        return new Response("Too many playground databases requested.", {
          status: 429,
          headers: { "Retry-After": "3600" },
        });
      }
    }
  }

  const response = await emdashPlayground(context, next);
  return response ?? new Response(null, { status: 204 });
});
