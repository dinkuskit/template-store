import type { SandboxOptions } from "emdash";
import { createSandboxRunner as createRegistrySandboxRunner } from "../registry-sandbox/runner.js";

/**
 * The playground's sandbox runner. Payments and Ship never reach DinkusKit.com
 * from the playground: every call they make is answered here, inside the
 * playground Worker (GrillTrack playground-prospect-demo-20261022). Until the
 * pretend-connected DinkusKit lands (playground-pretend-connected-20261022),
 * each call gets a plain "not available in the playground" answer.
 */
export function playgroundPluginFetch(): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ error: "playground", message: "DinkusKit.com is not connected in the playground." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export function createSandboxRunner(options: SandboxOptions) {
  return createRegistrySandboxRunner({ ...options, httpFetch: playgroundPluginFetch() });
}
