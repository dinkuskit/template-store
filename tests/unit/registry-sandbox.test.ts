import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxOptions, PluginManifest } from "emdash";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown>, exports: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({
  env: platform.env,
  exports: platform.exports,
  WorkerEntrypoint: class {
    constructor(public ctx: unknown, public env: unknown) {}
  },
  // EmDash 1.4's sandbox bridge extends RpcTarget from cloudflare:workers.
  RpcTarget: class {},
}));
import { PluginBridge } from "@emdash-cms/cloudflare/sandbox";
import { createSandboxRunner } from "../../src/features/registry-sandbox/runner";

const manifest = { id: "sandbox-budget-probe", version: "1.0.0", capabilities: [], storage: {} } as unknown as PluginManifest;

function harness(invoke: (bridge: PluginBridge) => Promise<unknown>) {
  let descriptor: any;
  let bridgeProps: any;
  const db = {} as SandboxOptions["db"];
  platform.exports.PluginBridge = ({ props }: { props: unknown }) => {
    bridgeProps = props;
    return Reflect.construct(PluginBridge, [{ props }, { DB: db }]) as PluginBridge;
  };
  platform.env.LOADER = {
    get: (_name: string, create: () => unknown) => {
      descriptor = create();
      return { getEntrypoint: () => ({ invokeRoute: () => invoke(descriptor.env.BRIDGE) }) };
    },
  };
  return { db, descriptor: () => descriptor, props: () => bridgeProps };
}

afterEach(() => { vi.useRealTimers(); delete platform.env.LOADER; delete platform.exports.PluginBridge; });

describe("Registry stock Cloudflare sandbox budget", () => {
  it("passes 32 subrequests to the real loader while retaining isolation and callbacks", async () => {
    const h = harness(async () => ({ ok: true }));
    const beforeContentWrite = vi.fn();
    const options = { db: h.db, beforeContentWrite, siteInfo: { name: "Probe", url: "https://example.test", locale: "en" } };
    const runner = createSandboxRunner(options);
    const plugin = await runner.load(manifest, "export default {};");
    await expect(plugin.invokeRoute("probe", {}, { method: "GET", url: "https://example.test/probe", headers: {}, meta: { ip: null, userAgent: null, referer: null, geo: null } })).resolves.toEqual({ ok: true });
    expect(h.descriptor().limits).toEqual({ cpuMs: 50, subRequests: 32 });
    expect(h.descriptor().globalOutbound).toBeNull();
    expect(h.props().capabilities).toEqual([]);
    expect(h.props().storageCollections).toEqual([]);
    // The adapter retains its original DB/write guard and site context.
    expect((runner as any).options.db).toBe(h.db);
    expect((runner as any).options.beforeContentWrite).toBe(beforeContentWrite);
    expect(h.props().siteInfo).toEqual(options.siteInfo);
    await runner.terminateAll();
  });

  it("still denies content access through the real bridge when capability is absent", async () => {
    const h = harness(bridge => bridge.contentGet("products", "unowned"));
    const runner = createSandboxRunner({ db: h.db });
    const plugin = await runner.load(manifest, "export default {};");
    await expect(plugin.invokeRoute("probe", {}, { method: "GET", url: "https://example.test/probe", headers: {}, meta: { ip: null, userAgent: null, referer: null, geo: null } })).rejects.toThrow("Missing capability: content:read");
    await runner.terminateAll();
  });

  it("retains the stock 30 second wall timeout", async () => {
    vi.useFakeTimers();
    const h = harness(() => new Promise(() => {}));
    const runner = createSandboxRunner({ db: h.db });
    const plugin = await runner.load(manifest, "export default {};");
    const result = plugin.invokeRoute("probe", {}, { method: "GET", url: "https://example.test/probe", headers: {}, meta: { ip: null, userAgent: null, referer: null, geo: null } });
    const rejected = expect(result).rejects.toThrow("exceeded wall-time limit of 30000ms");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    await runner.terminateAll();
  });
});
