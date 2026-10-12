import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const configRelativePath = "runs/registry/wrangler.jsonc";
const configPath = resolve(root, configRelativePath);

function required(env, name, pattern) {
  const value = env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`Missing or invalid ${name}`);
  return value;
}

export function registryConfig(env) {
  const resourceName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID", /^[a-f0-9]{32}$/i);
  const workerName = required(env, "DINKUS_WORKER_NAME", resourceName);
  const databaseName = required(env, "DINKUS_D1_DATABASE_NAME", resourceName);
  const databaseId = required(env, "DINKUS_D1_DATABASE_ID", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  const bucketName = required(env, "DINKUS_R2_BUCKET_NAME", resourceName);
  const sessionId = required(env, "DINKUS_SESSION_KV_ID", /^[a-f0-9]{32}$/i);
  const rateNamespace = required(env, "DINKUS_RATE_LIMIT_NAMESPACE_ID", /^[1-9][0-9]{0,9}$/);
  if (Number(rateNamespace) > 4294967295) throw new Error("Invalid DINKUS_RATE_LIMIT_NAMESPACE_ID");
  let siteUrl;
  try {
    siteUrl = new URL(env.EMDASH_SITE_URL);
  } catch {
    throw new Error("Missing or invalid EMDASH_SITE_URL");
  }
  if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password ||
      siteUrl.port || siteUrl.pathname !== "/" || siteUrl.search || siteUrl.hash) {
    throw new Error("EMDASH_SITE_URL must be an HTTPS origin without credentials, port, path, query or fragment");
  }
  const adminEnabled = env.DINKUS_EMDASH_ADMIN_ENABLED ?? "0";
  if (adminEnabled !== "0" && adminEnabled !== "1") throw new Error("Invalid DINKUS_EMDASH_ADMIN_ENABLED");
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: workerName,
    account_id: accountId,
    main: "../../src/worker.ts",
    compatibility_date: "2026-10-07",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    vars: {
      DINKUS_CATALOG_PROFILE: "shipping",
      DINKUS_STOREFRONT_PROFILE: "shipping",
      DINKUS_PROOF_MODE: "0",
      DINKUS_LAUNCH_INDEXABLE: "0",
      DINKUS_EMDASH_ADMIN_ENABLED: adminEnabled,
      EMDASH_SITE_URL: siteUrl.origin,
    },
    assets: { binding: "ASSETS", directory: "../../dist/client", run_worker_first: true },
    d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: bucketName }],
    kv_namespaces: [{ binding: "SESSION", id: sessionId }],
    worker_loaders: [{ binding: "LOADER" }],
    triggers: { crons: ["* * * * *"] },
    ratelimits: [{ name: "RATE_LIMITER", namespace_id: rateNamespace, simple: { limit: 120, period: 60 } }],
  };
}

export function registryBuildEnv(env, config) {
  const childEnv = { ...env, ...config.vars,
    DINKUS_HOSTING_PROFILE: "cloudflare", ASTRO_ADAPTER: "cloudflare",
    DINKUS_WRANGLER_CONFIG: configRelativePath };
  delete childEnv.CLOUDFLARE_ENV;
  return childEnv;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/build-registry.mjs [--dry-run | --config-only] [--json]\nValidate required non-secret deployment variables, write ignored Registry config, and build. Never provisions or deploys. See docs/implementation/registry-git-build.md.");
  } else {
    try {
      if (args.some(arg => !["--dry-run", "--config-only", "--json"].includes(arg)) ||
          (args.includes("--dry-run") && args.includes("--config-only"))) throw new Error("Invalid arguments; use --help");
      const config = registryConfig(process.env);
      const dryRun = args.includes("--dry-run");
      let status = dryRun ? "validated" : "configured";
      if (!dryRun) {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        if (!args.includes("--config-only")) {
          const build = spawnSync(process.execPath, [resolve(root, "scripts/build-demo.mjs")], {
            cwd: root, env: registryBuildEnv(process.env, config),
            stdio: args.includes("--json") ? ["ignore", process.stderr, process.stderr] : "inherit",
          });
          if (build.error) throw new Error("Unable to start Registry build");
          if (build.status !== 0) process.exit(build.status ?? 1);
          status = "built";
        }
      }
      const receipt = { status, config: configRelativePath, profile: "shipping", adminEnabled: config.vars.DINKUS_EMDASH_ADMIN_ENABLED === "1", deployed: false };
      console.log(args.includes("--json") ? JSON.stringify(receipt) : `Registry ${status}: ${configRelativePath}; no deployment performed.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
