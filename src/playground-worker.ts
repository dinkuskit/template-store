import astroHandler from "@astrojs/cloudflare/entrypoints/server";
import { EmDashPreviewDB } from "@emdash-cms/cloudflare/db/playground";
import {
  applyPlaygroundNoIndex,
  dropRewrittenBodyHeaders,
  injectPlaygroundNoIndex,
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
    const response = await (
      astroHandler as {
        fetch(
          request: Request,
          env: Record<string, unknown>,
          ctx: WorkerExecutionContext,
        ): Promise<Response>;
      }
    ).fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    applyPlaygroundNoIndex(headers);

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
