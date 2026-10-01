/**
 * Local-only index initialization through the Astro-built Worker.
 *
 * `wrangler dev --test-scheduled` reserves loopback `/__scheduled` and dispatches
 * the Worker `scheduled` export. Production fetch does not expose that route.
 * This script never passes `--remote` and does not open a Cloudflare API session.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const COMMERCE_SKU_UNIQUE_INDEX =
  "uidx_plugin_dinkus-commerce_catalogItems_skuKey";

const root = resolve(import.meta.dirname, "..");
const localConfigPath = resolve(root, ".artifacts/wrangler.local.jsonc");
const harnessConfigPath = resolve(root, ".artifacts/wrangler.scheduled.jsonc");
const entryPath = resolve(root, "dist/server/entry.mjs");
const wranglerBin = resolve(root, "node_modules/wrangler/bin/wrangler.js");

function fail(message) {
  console.error(JSON.stringify({ event: "scheduled.refused", message }));
  process.exitCode = 1;
}

function readPersistArg(argv) {
  let persist;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--persist") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--persist needs the getPlatformProxy directory and it must end with /v3.");
      }
      persist = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${arg}.`);
  }
  if (persist === undefined) {
    throw new Error("--persist is required and must be the getPlatformProxy directory ending with /v3.");
  }
  const resolved = resolve(root, persist);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error("Persist directory must stay inside this repository.");
  }
  if (!resolved.endsWith("/v3")) {
    throw new Error("Persist directory must be the v3 directory Wrangler opens under --persist-to.");
  }
  return resolved;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
    server.on("error", reject);
  });
}

function entryExportsScheduled() {
  if (!existsSync(entryPath)) return false;
  const text = readFileSync(entryPath, "utf8");
  return /\bscheduled\s*:/.test(text);
}

function ensureCloudflareBuild() {
  spawnSync(process.execPath, ["scripts/write-local-wrangler.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (entryExportsScheduled()) return;
  const build = spawnSync("pnpm", ["build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DINKUS_HOSTING_PROFILE: "cloudflare",
      DINKUS_WRANGLER_CONFIG: localConfigPath,
    },
  });
  if (build.status !== 0 || !entryExportsScheduled()) {
    throw new Error(
      "The Astro Cloudflare build did not emit a Worker scheduled export. Index initialization cannot use a private runtime.",
    );
  }
}

function writeHarnessConfig() {
  const local = JSON.parse(readFileSync(localConfigPath, "utf8"));
  const harness = {
    ...local,
    main: entryPath,
  };
  delete harness.no_bundle;
  mkdirSync(dirname(harnessConfigPath), { recursive: true });
  writeFileSync(harnessConfigPath, `${JSON.stringify(harness, null, 2)}\n`);
}

function walkSqlite(directory, found) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walkSqlite(path, found);
      continue;
    }
    if (entry.name.endsWith(".sqlite")) found.push(path);
  }
}

function indexPresent(persistPath) {
  const files = [];
  walkSqlite(persistPath, files);
  for (const file of files) {
    const query = spawnSync(
      "sqlite3",
      [
        file,
        `SELECT name FROM sqlite_master WHERE type='index' AND name='${COMMERCE_SKU_UNIQUE_INDEX}'`,
      ],
      { encoding: "utf8" },
    );
    if (query.status === 0 && query.stdout.includes(COMMERCE_SKU_UNIQUE_INDEX)) {
      return true;
    }
  }
  return false;
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return Promise.resolve();
    }
  }
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The exact child group already exited.
      }
      resolveStop();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function triggerScheduled(port, child, log) {
  const deadline = Date.now() + 120000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler exited ${child.exitCode} before /__scheduled.\n${log.at(-1) ?? ""}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__scheduled`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.text();
      if (response.ok && body.includes("Ran scheduled event")) return;
      lastError = `${response.status} ${body.slice(0, 240)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "fetch failed";
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`Built Worker scheduled harness did not answer loopback /__scheduled: ${lastError}`);
}

async function waitForIndex(persistPath) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (indexPresent(persistPath)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(
    `${COMMERCE_SKU_UNIQUE_INDEX} was not created by runScheduledTasks. No seed SQL was authored.`,
  );
}

async function main() {
  const persistPath = readPersistArg(process.argv);
  ensureCloudflareBuild();
  writeHarnessConfig();
  mkdirSync(persistPath, { recursive: true });
  const port = await freePort();
  const inspectorPort = await freePort();
  const log = [];
  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--config",
      harnessConfigPath,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      dirname(persistPath),
      "--test-scheduled",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  const append = (chunk) => {
    const text = String(chunk);
    log.push(text);
    if (log.length > 80) log.shift();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let failure;
  try {
    await triggerScheduled(port, child, log);
    await waitForIndex(persistPath);
  } catch (error) {
    failure = error instanceof Error ? error.message : "Scheduled harness failed.";
  } finally {
    await stopChild(child);
  }
  if (failure && !indexPresent(persistPath)) {
    console.error(JSON.stringify({ event: "scheduled.failed", message: failure }));
    console.error(log.join("").slice(-4000));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    event: "scheduled.index",
    index: COMMERCE_SKU_UNIQUE_INDEX,
    present: true,
    port,
  }));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Scheduled harness failed.");
});
