import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { playgroundRegistryPlugins } from "../../src/features/playground-plugins/registry-plugins.mjs";
import { playgroundPluginFetch } from "../../src/features/playground-plugins/runner.js";
import { welcomeBlocks } from "../../src/features/playground-plugins/welcome-plugin.js";
import { retargetPlaygroundDeployLink, START_REAL_STORE_URL } from "../../src/features/playground/contract.js";

describe("Playground Payments, Ship and welcome card", () => {
  it("installs the released Payments and Ship Registry bundles as sandboxed plugins", () => {
    const pins = JSON.parse(readFileSync("package.json", "utf8")).dinkuskit.playgroundPlugins;
    const plugins = playgroundRegistryPlugins();
    expect(plugins.map((plugin) => [plugin.id, plugin.version])).toEqual([
      ["dinkus-payments", pins.payments.tag.slice(1)],
      ["dinkus-ship", pins.ship.tag.slice(1)],
    ]);
    for (const plugin of plugins) {
      expect(plugin.format).toBe("standard");
      expect(plugin.entrypoint).toMatch(/\.artifacts\/playground-plugins\/(payments|ship)\/package\/backend\.js$/);
      expect(plugin.adminPages.length).toBeGreaterThan(0);
    }
  });

  it("gives the sandbox the Worker Loader binding in production and previews", () => {
    const config = readFileSync("wrangler.playground.jsonc", "utf8");
    expect(config.match(/"worker_loaders": \[\s*\{\s*"binding": "LOADER"\s*\}\s*\]/g)).toHaveLength(2);
  });

  it("answers every Payments and Ship call inside the playground, never on the network", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const answer = await playgroundPluginFetch()("https://dinkuskit.com/account/connect", { method: "POST" });
    expect(network).not.toHaveBeenCalled();
    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: "playground" });
    network.mockRestore();
  });

  it("ticks off the steps a prospect has done and keeps one link out to DinkusKit.com", () => {
    const fresh = JSON.stringify(welcomeBlocks("https://playground.dinkuskit.com", { productEdited: false, orders: 0, checkoutOpen: true }));
    expect(fresh).toContain("0 of 2 things to do so far");
    expect(fresh).toContain("○ Edit a product");
    expect(fresh).toContain("https://playground.dinkuskit.com/_emdash/admin/plugins/dinkus-commerce/products");
    expect(fresh).not.toContain("/_emdash/admin/content/");
    expect(fresh).toContain("https://playground.dinkuskit.com/_emdash/admin/plugins/dinkus-ship/shipping");

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
