import astroHandler from "@astrojs/cloudflare/entrypoints/server";
import { EmDashPreviewDB } from "@emdash-cms/cloudflare/db/playground";
import {
  CLEAR_PLAYGROUND_COOKIE,
  PLAYGROUND_COOKIE_NAME,
  applyPlaygroundNoIndex,
  dropRewrittenBodyHeaders,
  injectPlaygroundNoIndex,
  isPlaygroundInitFailure,
  isUsablePlaygroundSession,
  readPlaygroundSession,
  recoverFromPlaygroundInitFailure,
  withoutPlaygroundSession,
} from "./features/playground/contract.js";

export { EmDashPreviewDB };

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: WorkerExecutionContext,
  ): Promise<Response> {
    // An unknown or expired session cookie cannot name a usable store; drop it
    // so EmDash redirects to /playground and mints a fresh session.
    const session = readPlaygroundSession(request);
    const staleSession = session !== undefined && !isUsablePlaygroundSession(session);
    if (staleSession) request = withoutPlaygroundSession(request);
    (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv = env;
    let response = await (
      astroHandler as {
        fetch(
          request: Request,
          env: Record<string, unknown>,
          ctx: WorkerExecutionContext,
        ): Promise<Response>;
      }
    ).fetch(request, env, ctx);
    if (await isPlaygroundInitFailure(response)) {
      console.error("[playground] init failed; resetting the visitor session");
      response = recoverFromPlaygroundInitFailure(request, response);
    }
    const headers = new Headers(response.headers);
    applyPlaygroundNoIndex(headers);
    if (
      staleSession &&
      !headers.getSetCookie().some((c) => c.startsWith(`${PLAYGROUND_COOKIE_NAME}=`))
    ) {
      headers.append("Set-Cookie", CLEAR_PLAYGROUND_COOKIE);
    }

    if (!headers.get("content-type")?.includes("text/html")) {
      return new Response(response.body, { status: response.status, headers });
    }

    const html = injectPlaygroundNoIndex(await response.text());
    dropRewrittenBodyHeaders(headers);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
