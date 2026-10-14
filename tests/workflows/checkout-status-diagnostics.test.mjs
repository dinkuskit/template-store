import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const tools = createRequire(require.resolve("wrangler/package.json"));
const { build } = await import(pathToFileURL(tools.resolve("esbuild")));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } =
  await import(pathToFileURL(tools.resolve("miniflare")));
const envelope = (code) => ({ success: true, data: { ok: false,
  error: { code, message: "private-upstream-fixture", details: "private-details-fixture" } } });

test("native status failures expose only static diagnostic categories", async (t) => {
  await mkdir("runs", { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), "runs/status-diagnostics-"));
  const worker = join(directory, "worker.mjs");
  const site = "https://store.example.test";
  try {
    await build({ stdin: { contents: 'import { POST } from "./src/pages/api/checkout/status.ts"; export default { fetch(request) { return POST({ request }); } };', resolveDir: process.cwd() },
      bundle: true, platform: "neutral", format: "esm", outfile: worker });
    const cases = [
      ["origin", 200, envelope("ORIGIN_DENIED"), "CHECKOUT_STATUS_ORIGIN_DENIED"],
      ["capability", 200, envelope("CAPABILITY_DENIED"), "CHECKOUT_STATUS_CAPABILITY_DENIED"],
      ["missing checkout", 200, envelope("CHECKOUT_NOT_FOUND"), "CHECKOUT_STATUS_NOT_FOUND"],
      ["unavailable", 200, envelope("UNAVAILABLE"), "CHECKOUT_STATUS_UNAVAILABLE"],
      ["payments unavailable", 200, envelope("PAYMENTS_UNAVAILABLE"), "CHECKOUT_STATUS_UNAVAILABLE"],
      ["unknown", 200, envelope("private-code-fixture"), "CHECKOUT_UNAVAILABLE"],
      ["redirect", 302, null, "CHECKOUT_STATUS_UPSTREAM_REDIRECT"],
      ["HTTP failure", 502, envelope("CAPABILITY_DENIED"), "CHECKOUT_STATUS_UPSTREAM_HTTP_502"],
      ["HTTP lower bound", 400, envelope("private-code-fixture"), "CHECKOUT_STATUS_UPSTREAM_HTTP_400"],
      ["HTTP forbidden", 403, envelope("private-code-fixture"), "CHECKOUT_STATUS_UPSTREAM_HTTP_403"],
      ["HTTP rate limit", 429, envelope("private-code-fixture"), "CHECKOUT_STATUS_UPSTREAM_HTTP_429"],
      ["HTTP upper bound", 599, envelope("private-code-fixture"), "CHECKOUT_STATUS_UPSTREAM_HTTP_599"],
      ["spoofed domain code", 200, envelope("CHECKOUT_STATUS_UPSTREAM_HTTP_403"), "CHECKOUT_UNAVAILABLE"],
      ["malformed", 200, { success: true, data: { ok: true } }, "CHECKOUT_STATUS_RESPONSE_INVALID"],
    ];
    for (const [name, upstreamStatus, payload, expectedCode] of cases) {
      await t.test(name, async () => {
        let calls = 0;
        const mf = new Miniflare(convertV4MiniflareOptions({ name: "status-diagnostics", modules: true, scriptPath: worker,
          compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
          cf: false, telemetry: { enabled: false }, log: new Log(LogLevel.ERROR), bindings: { EMDASH_SITE_URL: site },
          outboundService: async () => { calls++; return Response.json(payload, { status: upstreamStatus,
            headers: { location: "https://private-upstream-fixture.invalid", "x-private-fixture": "private-header-fixture" } }); },
        }));
        try {
          await mf.ready;
          const response = await mf.dispatchFetch(site + "/api/checkout/status", { method: "POST",
            headers: { origin: site, "x-commerce-guest-capability": "cap.synthetic" }, body: "{}" });
          assert.equal(response.status, 503);
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.equal(response.headers.get("location"), null);
          assert.equal(response.headers.get("x-private-fixture"), null);
          const body = await response.json();
          assert.deepEqual(body, { ok: false, error: { code: expectedCode, message: "Checkout status unavailable." } });
          assert.equal(JSON.stringify(body).includes("private-"), false);
          assert.equal(JSON.stringify(body).includes("cap.synthetic"), false);
          assert.equal(calls, 1);
        } finally { await mf.dispose(); }
      });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
