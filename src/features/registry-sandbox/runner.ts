import type { SandboxOptions } from "emdash";
import { createSandboxRunner as createCloudflareSandboxRunner } from "@emdash-cms/cloudflare/sandbox";

/** Registry plugins need room for an admin write followed by its list render. */
export function createSandboxRunner(options: SandboxOptions) {
  return createCloudflareSandboxRunner({
    ...options,
    limits: { ...options.limits, subrequests: 32 },
  });
}
