import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function runSeed(args: string[], env: NodeJS.ProcessEnv = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "./scripts/cloudflare-workers-hook.mjs", ".artifacts/seed/seed-synthetic-demo.mjs", ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ...env },
        timeout: 180000,
      },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failed.status ?? 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

describe("synthetic demo D1 seed", () => {
  it("refuses remote and arbitrary paths without opening a database", () => {
    execFileSync(process.execPath, ["scripts/build-seed-bundle.mjs"], {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 60000,
    });
    const remote = runSeed(["--remote"]);
    expect(remote.status).toBe(2);
    expect(remote.stderr).toContain("REMOTE_SEED_UNPROVED");
    const arbitrary = runSeed([], { D1_DB_PATH: "/tmp/not-a-target.sqlite" });
    expect(arbitrary.status).toBe(2);
    expect(arbitrary.stderr).toContain("ARBITRARY_DB_PATH_REJECTED");
  }, 120000);

  it("repeats the demo seed and preserves a non-demo sentinel", () => {
    execFileSync(process.execPath, ["scripts/build-seed-bundle.mjs"], {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 60000,
    });
    mkdirSync(".artifacts", { recursive: true });
    const parent = mkdtempSync(join(process.cwd(), ".artifacts/seed-repeat-"));
    const persist = join(parent, "v3");
    try {
      const harness = execFileSync(
        process.execPath,
        ["scripts/scheduled-index-harness.mjs", "--persist", persist],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 420000,
        },
      );
      expect(harness).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");
      const first = runSeed(["--prove-sentinel", "--persist", persist]);
      expect(first.status, first.stderr || first.stdout).toBe(0);
      expect(first.stdout).toContain("DEMO-HOSTED-SHIRT");
      expect(first.stdout).toContain("DEMO-HOSTED-CAP");
      expect(first.stdout).toContain("DEMO-HOSTED-MUG");
      expect(first.stdout).toContain("\"nonDemo\":1");
      const second = runSeed(["--prove-sentinel", "--persist", persist]);
      expect(second.status, second.stderr || second.stdout).toBe(0);
      expect(second.stdout).toContain("\"unchanged\":true");
      expect(second.stdout).toContain("\"home\":\"home\"");
      expect(second.stdout).toContain("DEMO-HOSTED-CAP");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 540000);
});
