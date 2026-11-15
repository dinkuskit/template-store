import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PLAYGROUND_INSTALLED_PLUGIN_IDS,
  playgroundRegistryPlugins,
  retargetPlaygroundPluginLinks,
} from "../../src/features/playground-plugins/registry-plugins.mjs";
import { playgroundDinkusKitFetch, playgroundPluginSettingsKey, standInStoreKey } from "../../src/features/playground-plugins/dinkuskit-stand-in.js";
import { PLAYGROUND_TOUR_PAGE_ENTRY, readTourCopy, TOUR_COPY_DEFAULTS } from "../../src/features/playground-tour/copy.js";
import { EMPTY_TOUR_STATE, nextTourStep, tourSteps, type TourState } from "../../src/features/playground-tour/state.js";
import { tourBlocks } from "../../src/features/playground-tour/tour-plugin.js";
import { retargetPlaygroundDeployLink, START_REAL_STORE_URL } from "../../src/features/playground/contract.js";

describe("Playground Payments, Ship and tour", () => {
  it("installs the pinned Commerce and the released Payments and Ship Registry bundles under their Registry ids", () => {
    const { sourcePins, playgroundPlugins: pins } = JSON.parse(readFileSync("package.json", "utf8")).dinkuskit;
    const plugins = playgroundRegistryPlugins();
    expect(plugins.map((plugin) => [plugin.id, plugin.version])).toEqual([
      [PLAYGROUND_INSTALLED_PLUGIN_IDS.commerce, sourcePins.commerce.tag.slice(1)],
      [PLAYGROUND_INSTALLED_PLUGIN_IDS.payments, pins.payments.tag.slice(1)],
      [PLAYGROUND_INSTALLED_PLUGIN_IDS.ship, pins.ship.tag.slice(1)],
    ]);
    expect(PLAYGROUND_INSTALLED_PLUGIN_IDS.commerce).toBe("r_gshdrqaldna3r7sn");
    for (const plugin of plugins) {
      expect(plugin.format).toBe("standard");
      expect(plugin.entrypoint).toMatch(/\.artifacts\/playground-plugins\/(commerce|payments|ship)\/package\/backend\.js$/);
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

    it("keeps everything it hands out inside the playground", async () => {
      network.mockClear();
      const storeKey = await standInStoreKey("dinkus-ship-emdash");
      const refused = await post("https://dinkuskit.com/api/store-passes", { site_id: "someone-else", scope: "ship:admin", audience: "dinkus-ship" },
        { authorization: `Bearer ${storeKey}` });
      expect(refused.status).toBe(403);
      const wrongService = await post("https://dinkuskit.com/api/store-passes", { site_id: "playground", scope: "payments:checkout", audience: "dinkus-payments" },
        { authorization: `Bearer ${storeKey}` });
      expect(wrongService.status).toBe(403);
      const pass = await (await post("https://dinkuskit.com/api/store-passes", { site_id: "playground", scope: "ship:admin", audience: "dinkus-ship" },
        { authorization: `Bearer ${storeKey}` })).json() as { access_token: string };
      // A pretend pass answers here even for a page the pretend Ship doesn't have; it never reaches the real Ship or Payments.
      const unknown = await standIn("https://ship.dinkuskit.com/v1/admin/refunds", { headers: { authorization: `Bearer ${pass.access_token}` } });
      expect(unknown.ok).toBe(false);
      const payments = await standIn("https://payments.dinkuskit.com/v1/checkout", { method: "POST", headers: { authorization: `Bearer ${pass.access_token}` } });
      expect(payments.status).toBe(404);
      expect(network).not.toHaveBeenCalled();
    });

    it("leaves a real store key and other hosts to the real services, and guards every real-pass Payments call", async () => {
      network.mockClear();
      await post("https://dinkuskit.com/api/store-passes", { site_id: "s", scope: "payments:checkout", audience: "dinkus-payments" },
        { authorization: "Bearer dk_store_real" });
      await standIn("https://example.com/");
      expect(network).toHaveBeenCalledTimes(2);
      // Without the playground's Payments tenant configured, the guard refuses before the network.
      const guarded = await standIn("https://payments.dinkuskit.com/v1/checkout/session", {
        method: "POST", headers: { authorization: "Bearer real.pass.token" }, body: new TextEncoder().encode("{}"),
      });
      expect(guarded.status).toBe(503);
      expect(network).toHaveBeenCalledTimes(2);
    });
  });

  it("encrypts plugin settings with one key every isolate agrees on", async () => {
    const off = await playgroundPluginSettingsKey({});
    expect(off).toMatch(/^emdash_enc_v1_[A-Za-z0-9_-]{43}$/);
    expect(await playgroundPluginSettingsKey({})).toBe(off);
    const on = await playgroundPluginSettingsKey({ PAYMENTS_STORE_KEY: "dk_store_secret" });
    expect(on).toBe(await playgroundPluginSettingsKey({ PAYMENTS_STORE_KEY: "dk_store_secret" }));
    expect(on).not.toBe(off);
    expect(on).not.toContain("secret");
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

  const ORIGIN = "https://playground.dinkuskit.com";
  const copy = readTourCopy(PLAYGROUND_TOUR_PAGE_ENTRY.data.content as never);
  const state = (patch: Partial<TourState> = {}): TourState => ({ ...EMPTY_TOUR_STATE, checkoutOpen: true, ...patch });

  it("walks the tour in order: edit a product, connect Payments, order, ship, then start a real store", () => {
    const order = (patch: Partial<TourState>) => nextTourStep(tourSteps(state(patch))).id;
    expect(order({})).toBe("edit-product");
    expect(order({ productEdited: true })).toBe("connect-payments");
    expect(order({ productEdited: true, paymentsConnected: true })).toBe("place-order");
    expect(order({ productEdited: true, paymentsConnected: true, orders: 1 })).toBe("ship-order");
    expect(order({ productEdited: true, paymentsConnected: true, orders: 1, labels: 1 })).toBe("real-store");
    // A step done out of order still ticks; the next one is the first not done.
    expect(order({ productEdited: true, labels: 1 })).toBe("connect-payments");
  });

  it("shows one next step with Take me there, ticks done steps and keeps one link out to DinkusKit.com", () => {
    const fresh = JSON.stringify(tourBlocks(ORIGIN, state(), copy));
    expect(fresh).toContain("0 of 4 steps done");
    expect(fresh).toContain("Next: Edit a product");
    expect(fresh).toContain("Take me there");
    expect(fresh).toContain('"action_id":"tour_check_progress"');
    expect(fresh).toContain("→ Edit a product (next)");
    expect(fresh).toContain("○ Connect Payments");
    expect(fresh).toContain(`${ORIGIN}/_emdash/admin/content/products`);
    expect(fresh).toContain(`${ORIGIN}/_emdash/admin/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.payments}/status`);
    expect(fresh).toContain(`${ORIGIN}/_emdash/admin/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.ship}/shipping`);
    expect(fresh).toContain(`${ORIGIN}/playground-tour`);

    const halfway = JSON.stringify(tourBlocks(ORIGIN, state({ productEdited: true, paymentsConnected: true }), copy, ["connect-payments"]));
    expect(halfway).toContain("Done: Connect Payments ✓");
    expect(halfway).toContain("Next: Place a test order.");
    expect(halfway).toContain("✓ Edit a product (done)");
    expect(halfway).toContain("4242 4242 4242 4242");

    const finished = tourBlocks(ORIGIN, state({ productEdited: true, paymentsConnected: true, orders: 1, labels: 2 }), copy);
    const text = JSON.stringify(finished);
    expect(text).toContain("4 of 4 steps done");
    expect(text).not.toContain("tour_check_progress");
    const outside = [...text.matchAll(/"url":"(https:\/\/[^"]+)"/g)]
      .map(([, url]) => new URL(url).origin)
      .filter((origin) => origin !== ORIGIN);
    expect(new Set(outside)).toEqual(new Set(["https://dinkuskit.com"]));
    expect(text).toContain(START_REAL_STORE_URL);
  });

  it("only invites a test order when the playground's checkout is open", () => {
    const closed = JSON.stringify(tourBlocks("https://pr-137.playground.dinkuskit.com", state({ checkoutOpen: false, productEdited: true, paymentsConnected: true }), copy));
    expect(closed).not.toContain("4242");
    expect(closed).not.toContain("Place a test order");
    expect(closed).toContain("Next: Look at your shop");
    expect(closed).toContain("Checkout is switched off in this playground");
    expect(nextTourStep(tourSteps(state({ checkoutOpen: false, productEdited: true, paymentsConnected: true, shopVisited: true }))).id).toBe("ship-order");
  });

  it("takes the tour's words from the CMS page, falling back to its own for a missing step", () => {
    const content = PLAYGROUND_TOUR_PAGE_ENTRY.data.content.map((block) =>
      block._key === "edit-product-title" ? { ...block, children: [{ ...block.children[0]!, text: "Change a price" }] } : block,
    ).filter((block) => block._key !== "ship-order-text");
    const edited = readTourCopy(content as never);
    expect(edited["edit-product"].title).toBe("Change a price");
    expect(edited["ship-order"].text).toBe(TOUR_COPY_DEFAULTS["ship-order"].text);
    expect(readTourCopy(undefined)).toEqual(copy);
    // Every step and hint has a heading and a paragraph in the seeded page.
    const keys = new Set(PLAYGROUND_TOUR_PAGE_ENTRY.data.content.map((block) => block._key));
    for (const key of Object.keys(TOUR_COPY_DEFAULTS)) {
      expect(keys.has(`${key}-title`) && keys.has(`${key}-text`)).toBe(true);
    }
  });

  it("sends Start your real store to DinkusKit.com's onboarding page", () => {
    expect(START_REAL_STORE_URL).toBe("https://dinkuskit.com/start");
  });

  it("turns EmDash's toolbar Deploy your own button into Start your real store", () => {
    // The toolbar EmDash 1.4.0 really injects, so an upstream markup change fails here.
    const toolbar = readFileSync("node_modules/@emdash-cms/cloudflare/dist/db/playground-middleware.mjs", "utf8");
    const page = `<body>${toolbar}</body>`;
    const retargeted = retargetPlaygroundDeployLink(page);
    expect(retargeted).not.toContain("https://github.com/emdash-cms/emdash");
    expect(retargeted).not.toContain("Deploy your own");
    expect(retargeted).toContain(`href="${START_REAL_STORE_URL}" target="_blank" rel="noopener">\n      Start your real store`);
    expect(retargetPlaygroundDeployLink("<p>no toolbar</p>")).toBe("<p>no toolbar</p>");
  });
});
