import astroHandler from "@astrojs/cloudflare/entrypoints/server";
import { EmDashPreviewDB } from "@emdash-cms/cloudflare/db/playground";
import { PluginBridge } from "@emdash-cms/cloudflare/worker";
import {
  CLEAR_PLAYGROUND_COOKIE,
  PLAYGROUND_COOKIE_NAME,
  applyPlaygroundNoIndex,
  dropRewrittenBodyHeaders,
  injectPlaygroundNoIndex,
  injectPlaygroundStoreTag,
  isPlaygroundInitFailure,
  isUsablePlaygroundSession,
  playgroundSessionCreatedAt,
  playgroundStoreTag,
  readPlaygroundSession,
  recoverFromPlaygroundInitFailure,
  retargetPlaygroundDeployLink,
  startedPlaygroundSession,
  withoutPlaygroundSession,
} from "./features/playground/contract.js";
import { withShopperAccountRequest } from "./features/shopper-account/playground-runtime.js";

// Payments and Ship run in the sandbox, which reaches EmDash through PluginBridge.
export { EmDashPreviewDB, PluginBridge };

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
    const requestOrigin = new URL(request.url).origin;
    (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv = env;
    (globalThis as { __dinkusPlaygroundRequestOrigin?: string }).__dinkusPlaygroundRequestOrigin =
      requestOrigin;
    let response = await withShopperAccountRequest(requestOrigin, env, () =>
      (
        astroHandler as {
          fetch(
            request: Request,
            env: Record<string, unknown>,
            ctx: WorkerExecutionContext,
          ): Promise<Response>;
        }
      ).fetch(request, env, ctx),
    );
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

    let html = retargetPlaygroundDeployLink(injectPlaygroundNoIndex(await response.text()));
    const store = startedPlaygroundSession(headers) ?? (staleSession ? undefined : session);
    const started = store === undefined ? undefined : playgroundSessionCreatedAt(store);
    if (store && started !== undefined) html = injectPlaygroundStoreTag(html, await playgroundStoreTag(store), started);
    dropRewrittenBodyHeaders(headers);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
