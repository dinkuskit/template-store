import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const toolRequire = createRequire(require.resolve("wrangler/package.json"));
const { build } = await import(pathToFileURL(toolRequire.resolve("esbuild")));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } =
  await import(pathToFileURL(toolRequire.resolve("miniflare")));

test("status proxy uses native workerd fetch without following redirects", async (t) => {
  await mkdir("runs", { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), "runs/status-workerd-"));
  const worker = join(directory, "worker.mjs");
  const site = "https://store.example.test";
  try {
    await build({
      stdin: {
        contents: 'import { POST } from "./src/pages/api/checkout/status.ts"; export default { fetch(request) { return POST({ request }); } };',
        resolveDir: process.cwd(),
      },
      bundle: true, platform: "neutral", format: "esm", outfile: worker,
    });
    for (const upstreamStatus of [200, 302, 307]) {
      await t.test(`upstream ${upstreamStatus}`, async () => {
        const calls = [];
        const mf = new Miniflare(convertV4MiniflareOptions({
          name: "status-workerd", modules: true, scriptPath: worker,
          compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
          host: "127.0.0.1", port: 0, cf: false,
          telemetry: { enabled: false }, log: new Log(LogLevel.ERROR),
          bindings: { EMDASH_SITE_URL: site },
          // Intercept the network boundary, not global fetch: native workerd
          // still validates options and applies redirect handling.
          outboundService: async (request) => {
            calls.push(request.url);
            assert.equal(request.url, site + "/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/status");
            assert.equal(request.method, "POST");
            assert.equal(request.headers.get("origin"), site);
            assert.equal(request.headers.get("x-commerce-guest-capability"), "cap.synthetic");
            assert.equal(request.headers.get("authorization"), null);
            assert.equal(request.headers.get("cookie"), null);
            assert.equal(await request.text(), "{}");
            if (upstreamStatus !== 200) {
              return new Response(null, { status: upstreamStatus,
                headers: { location: "https://redirect.example.invalid/private" } });
            }
            return Response.json({ ok: true, capabilityId: "cap", checkout: {
              schema: "dinkuskit.commerce.guest-checkout-projection/v1",
              state: "pending", attemptId: null, redirectUrl: null, order: null, retryAfter: null,
            } });
          },
        }));
        try {
          await mf.ready;
          const response = await mf.dispatchFetch(site + "/api/checkout/status", {
            method: "POST", headers: { origin: site, "sec-fetch-site": "same-origin",
              "x-commerce-guest-capability": "cap.synthetic", authorization: "Bearer synthetic",
              cookie: "synthetic=1", "content-type": "application/json" }, body: "{}",
          });
          assert.equal(response.status, upstreamStatus === 200 ? 200 : 503);
          assert.equal(response.headers.get("location"), null);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const body = await response.json();
          assert.equal(body.ok, upstreamStatus === 200);
          if (upstreamStatus === 200) assert.equal(body.checkout.attemptId, null);
          else assert.equal(body.error.code, "CHECKOUT_UNAVAILABLE");
          assert.equal(JSON.stringify(body).includes("redirect.example.invalid"), false);
          assert.equal(JSON.stringify(body).includes("cap.synthetic"), false);
          assert.equal(calls.length, 1);
        } finally { await mf.dispose(); }
      });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
