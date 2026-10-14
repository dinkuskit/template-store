import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const tools = createRequire(require.resolve("wrangler/package.json"));
const { build } = await import(pathToFileURL(tools.resolve("esbuild")));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(tools.resolve("miniflare")));
export const site = "https://store.example.test";
export const checkout = { schema: "dinkuskit.commerce.guest-checkout-projection/v1", state: "pending",
  attemptId: null, redirectUrl: null, order: null, retryAfter: null };
export async function statusFixture(payload, { publicRoute = true, missingLocals = false } = {}) {
  await mkdir("runs", { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), "runs/public-status-"));
  const worker = join(directory, "worker.mjs");
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {POST} from './src/pages/api/checkout/status.ts';
    import {createPublicPluginApiRouteHandler} from './node_modules/emdash/src/astro/public-plugin-api-routes.ts';
    export default { async fetch(request, env) {
      let calls=0;
      const runtime={getPluginRouteMeta(){return {public:env.PUBLIC_ROUTE,methods:['POST']}},
        async handlePluginApiRoute(id,method,path,forwarded){
          calls++;
          if(id!=='r_gshdrqaldna3r7sn'||method!=='POST'||path!=='checkout/guest/status'||
            forwarded.url!=='${site}/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/status'||
            forwarded.headers.get('origin')!=='${site}'||forwarded.headers.get('x-commerce-guest-capability')!=='cap.synthetic'||forwarded.headers.has('cookie')||forwarded.headers.has('authorization')) throw new Error('invalid forwarding');
          return env.PAYLOAD;
        }};
      const host={...runtime,handlePublicPluginApiRoute:createPublicPluginApiRouteHandler(runtime)};
      const response=await POST({request,locals:env.MISSING_LOCALS?{}:{emdash:host}});
      response.headers.set('x-fixture-dispatch-calls',String(calls));return response;
    }};` }, bundle: true, platform: "neutral", format: "esm", outfile: worker });
  let outbound = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "public-status", modules: true, scriptPath: worker,
    compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
    cf: false, telemetry: { enabled: false }, log: new Log(LogLevel.ERROR),
    bindings: { EMDASH_SITE_URL: site, DINKUS_CATALOG_PROFILE: "shipping", PAYLOAD: payload, PUBLIC_ROUTE: publicRoute, MISSING_LOCALS: missingLocals },
    outboundService: async () => { outbound++; return new Response("HTTP forbidden", { status: 502 }); },
  }));
  await mf.ready;
  return { async request(headers = {}) { return mf.dispatchFetch(site + "/api/checkout/status", { method: "POST", headers: {
    origin: site, "x-commerce-guest-capability": "cap.synthetic", cookie: "private-cookie", authorization: "private-authorization", ...headers }, body: "{}" }); },
    outbound: () => outbound, async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
