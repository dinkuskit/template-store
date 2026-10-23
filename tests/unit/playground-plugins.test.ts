import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PLAYGROUND_INSTALLED_PLUGIN_IDS,
  playgroundRegistryPlugins,
  retargetPlaygroundPluginLinks,
} from "../../src/features/playground-plugins/registry-plugins.mjs";
import { playgroundDinkusKitFetch, standInStoreKey } from "../../src/features/playground-plugins/dinkuskit-stand-in.js";
import { welcomeBlocks } from "../../src/features/playground-plugins/welcome-plugin.js";
import { retargetPlaygroundDeployLink, START_REAL_STORE_URL } from "../../src/features/playground/contract.js";

describe("Playground Payments, Ship and welcome card", () => {
  it("installs the released Payments and Ship Registry bundles under their Registry ids", () => {
    const pins = JSON.parse(readFileSync("package.json", "utf8")).dinkuskit.playgroundPlugins;
    const plugins = playgroundRegistryPlugins();
    expect(plugins.map((plugin) => [plugin.id, plugin.version])).toEqual([
      [PLAYGROUND_INSTALLED_PLUGIN_IDS.payments, pins.payments.tag.slice(1)],
      [PLAYGROUND_INSTALLED_PLUGIN_IDS.ship, pins.ship.tag.slice(1)],
    ]);
    for (const plugin of plugins) {
      expect(plugin.format).toBe("standard");
      expect(plugin.entrypoint).toMatch(/\.artifacts\/playground-plugins\/(payments|ship)\/package\/backend\.js$/);
      expect(plugin.adminPages.length).toBeGreaterThan(0);
    }
  });

  it("runs them inside the visitor's store, not EmDash's sandbox", () => {
    const config = readFileSync("astro.playground.config.mjs", "utf8");
    expect(config).not.toMatch(/sandboxed:|sandboxRunner:/);
    expect(readFileSync("wrangler.playground.jsonc", "utf8")).not.toContain("worker_loaders");
  });

  describe("pretend DinkusKit.com", () => {
    const network = vi.fn(async () => new Response("network", { status: 599 }));
    const standIn = playgroundDinkusKitFetch(network as unknown as typeof fetch, {
      env: () => ({}),
      origin: () => "https://playground.dinkuskit.com",
    });
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      standIn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    it("approves Connect at once and hands Payments a store key and a signed pass", async () => {
      const started = await (await post("https://dinkuskit.com/api/store-connections", {
        protocol_version: 2, client_id: "dinkus-payments-emdash", service: "payments",
        site_origin: "https://playground.dinkuskit.com", callback_uri: "https://playground.dinkuskit.com/cb", code_challenge: "x",
      })).json() as Record<string, unknown>;
      expect(started.verification_uri).toBe(`https://dinkuskit.com/account/connect?connection_id=${started.connection_id}`);
      const approved = await (await post("https://dinkuskit.com/api/store-connections/token", {
        client_id: "dinkus-payments-emdash", connection_id: started.connection_id, code_verifier: "v",
      })).json() as Record<string, string>;
      expect(approved.store_key).toBe(await standInStoreKey("dinkus-payments-emdash"));
      expect(approved.store_key).toMatch(/^dk_store_[A-Za-z0-9_-]{43}$/);
      expect(approved.token_type).toBe("Bearer");

      const status = await standIn("https://payments.dinkuskit.com/v1/status", { headers: { authorization: `Bearer ${approved.access_token}` } });
      expect(await status.json()).toMatchObject({ state: "ready", mode: "test", connectionEvidence: { provider: "stripe", result: "verified" } });
      const jwks = await (await standIn("https://dinkuskit.com/account/.well-known/jwks.json")).json() as { keys: { kid: string }[] };
      expect(jwks.keys.map((k) => k.kid)).toEqual(["dinkuskit-playground-stand-in"]);
      expect(network).not.toHaveBeenCalled();
    });

    it("leaves a real store key and real passes to the real services", async () => {
      await post("https://dinkuskit.com/api/store-passes", { site_id: "s", scope: "payments:checkout", audience: "dinkus-payments" },
        { authorization: "Bearer dk_store_real" });
      await standIn("https://payments.dinkuskit.com/v1/checkout", { headers: { authorization: "Bearer real.pass.token" } });
      await standIn("https://example.com/");
      expect(network).toHaveBeenCalledTimes(3);
    });
  });

  it("sends Connect and Ship's own pages to the playground's Connect page", () => {
    const ship = PLAYGROUND_INSTALLED_PLUGIN_IDS.ship;
    const rewrite = retargetPlaygroundPluginLinks(`/_emdash/api/plugins/${ship}/admin`, "https://playground.dinkuskit.com");
    expect(rewrite).not.toBeNull();
    const body = rewrite!(JSON.stringify({ a: "https://dinkuskit.com/account/connect?connection_id=abc", b: "https://ship.dinkuskit.com/stores/x/labels" }));
    expect(body).toContain(`https://playground.dinkuskit.com/connect-to-dinkuskit?back=${encodeURIComponent(`/_emdash/admin/plugins/${ship}/shipping`)}&connection_id=abc`);
    expect(body).not.toContain("ship.dinkuskit.com");
    expect(retargetPlaygroundPluginLinks("/_emdash/api/plugins/dinkus-commerce/admin", "https://x")).toBeNull();
  });

  it("ticks off the steps a prospect has done and keeps one link out to DinkusKit.com", () => {
    const fresh = JSON.stringify(welcomeBlocks("https://playground.dinkuskit.com", { productEdited: false, orders: 0, checkoutOpen: true }));
    expect(fresh).toContain("0 of 2 things to do so far");
    expect(fresh).toContain("○ Edit a product");
    expect(fresh).toContain("https://playground.dinkuskit.com/_emdash/admin/plugins/dinkus-commerce/products");
    expect(fresh).not.toContain("/_emdash/admin/content/");
    expect(fresh).toContain(`https://playground.dinkuskit.com/_emdash/admin/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.ship}/shipping`);

    const done = welcomeBlocks("https://playground.dinkuskit.com", { productEdited: true, orders: 1, checkoutOpen: true });
    const text = JSON.stringify(done);
    expect(text).toContain("2 of 2 things to do so far");
    expect(text).toContain("✓ Edit a product (done)");
    expect(text).toContain("✓ Place a test order (done)");
    const outside = [...text.matchAll(/"url":"(https:\/\/[^"]+)"/g)]
      .map(([, url]) => new URL(url).origin)
      .filter((origin) => origin !== "https://playground.dinkuskit.com");
    expect(outside).toEqual(["https://dinkuskit.com"]);
  });

  it("only invites a test order when the playground's checkout is open", () => {
    const closed = JSON.stringify(welcomeBlocks("https://pr-137.playground.dinkuskit.com", { productEdited: false, orders: 0, checkoutOpen: false }));
    expect(closed).not.toContain("4242");
    expect(closed).not.toContain("Place a test order");
    expect(closed).toContain("Test checkout is switched off in this playground");
    expect(closed).toContain("0 of 1 thing to do so far");
  });

  it("sends Start your real store to DinkusKit.com's onboarding page", () => {
    expect(START_REAL_STORE_URL).toBe("https://dinkuskit.com/start");
  });

  it("turns EmDash's toolbar Deploy your own button into Start your real store", () => {
    // The toolbar EmDash 1.2.0 really injects, so an upstream markup change fails here.
    const toolbar = readFileSync("node_modules/@emdash-cms/cloudflare/dist/db/playground-middleware.mjs", "utf8");
    const page = `<body>${toolbar}</body>`;
    const retargeted = retargetPlaygroundDeployLink(page);
    expect(retargeted).not.toContain("https://github.com/emdash-cms/emdash");
    expect(retargeted).not.toContain("Deploy your own");
    expect(retargeted).toContain(`href="${START_REAL_STORE_URL}" target="_blank" rel="noopener">\n      Start your real store`);
    expect(retargetPlaygroundDeployLink("<p>no toolbar</p>")).toBe("<p>no toolbar</p>");
  });
});
