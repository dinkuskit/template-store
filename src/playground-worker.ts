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
import { playgroundDinkusKitFetch, playgroundPluginSettingsKey } from "./features/playground-plugins/dinkuskit-stand-in.js";
import { retargetPlaygroundPluginLinks } from "./features/playground-plugins/registry-plugins.mjs";

// EmDash's runtime still looks for PluginBridge, though no plugin runs in the sandbox here.
export { EmDashPreviewDB, PluginBridge };

type PlaygroundGlobals = { __dinkusPlaygroundEnv?: Record<string, unknown>; __dinkusPlaygroundRequestOrigin?: string };
// Payments' and Ship's calls to DinkusKit.com are answered inside the playground.
globalThis.fetch = playgroundDinkusKitFetch(globalThis.fetch.bind(globalThis), {
  env: () => (globalThis as PlaygroundGlobals).__dinkusPlaygroundEnv ?? {},
  origin: () => (globalThis as PlaygroundGlobals).__dinkusPlaygroundRequestOrigin ?? "https://playground.dinkuskit.com",
});

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
    // A playground store is never set up by hand, so it has no Site URL. Payments
    // and Ship need one to connect; EmDash reads this once, on the first request.
    process.env.EMDASH_SITE_URL ||= requestOrigin;
    // Their Connect sign-in is a secret setting, which EmDash will only save encrypted.
    process.env.EMDASH_ENCRYPTION_KEY ||= await playgroundPluginSettingsKey(env);
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

    const pluginLinks = retargetPlaygroundPluginLinks(new URL(request.url).pathname, requestOrigin);
    if (pluginLinks && headers.get("content-type")?.includes("application/json")) {
      dropRewrittenBodyHeaders(headers);
      return new Response(pluginLinks(await response.text()), { status: response.status, headers });
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
