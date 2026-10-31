import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { registryAccessOptions, registryConfigPath } from "./registry-access.mjs";

import { commerceProfile } from "../src/features/commerce-profile/profiles.mjs";

const root = resolve(import.meta.dirname, "..");
const configRelativePath = registryConfigPath;
const configPath = resolve(root, configRelativePath);

function required(env, name, pattern) {
  const value = env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`Missing or invalid ${name}`);
  return value;
}

// Only this project checkout can establish the source used by the build. Git
// errors/status details never reach the receipt or operator logs.
function readCheckoutGit(checkoutRoot, args) {
  const result = spawnSync("git", ["-C", checkoutRoot, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error("Unable to verify Workers Builds Git checkout");
  }
  return result.stdout.trim();
}

export function assertBuildSource(env, checkoutRoot = root) {
  if (!env.WORKERS_CI) return;
  const branch = required(env, "DINKUS_EXPECTED_BRANCH", /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/);
  const commit = required(env, "DINKUS_EXPECTED_COMMIT", /^[a-f0-9]{40}$/i).toLowerCase();
  const account = required(env, "DINKUS_EXPECTED_ACCOUNT_ID", /^[a-f0-9]{32}$/i);
  if (env.WORKERS_CI_BRANCH !== branch) throw new Error("Workers Builds branch does not match DINKUS_EXPECTED_BRANCH");
  if (env.CLOUDFLARE_ACCOUNT_ID !== account) throw new Error("Workers Builds account does not match DINKUS_EXPECTED_ACCOUNT_ID");
  let projectRoot;
  try { projectRoot = realpathSync(checkoutRoot); }
  catch { throw new Error("Unable to verify Workers Builds Git checkout"); }
  if (readCheckoutGit(projectRoot, ["rev-parse", "--show-toplevel"]) !== projectRoot) {
    throw new Error("Workers Builds Git root does not match the project root");
  }
  const head = readCheckoutGit(projectRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head !== commit) throw new Error("Workers Builds Git HEAD does not match DINKUS_EXPECTED_COMMIT");
  const tree = readCheckoutGit(projectRoot, ["rev-parse", "--verify", "HEAD^{tree}"]);
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error("Unable to verify Workers Builds Git tree");
  if (readCheckoutGit(projectRoot, ["status", "--porcelain=v1", "--untracked-files=no"])) {
    throw new Error("Workers Builds tracked source is not clean");
  }
  const stamp = typeof env.WORKERS_CI_COMMIT_SHA === "string" ? env.WORKERS_CI_COMMIT_SHA : "";
  return { authority: "git-checkout", commit: head, tree, trackedClean: true,
    providerCommitStamp: { role: "observational", length: stamp.length, matchesCheckout: stamp === head } };
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
  const accessOptions = registryAccessOptions(env);
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
      DINKUS_COMMERCE_PROFILE: commerceProfile(env.DINKUS_COMMERCE_PROFILE).name,
      DINKUS_CATALOG_PROFILE: "shipping",
      DINKUS_STOREFRONT_PROFILE: "shipping",
      DINKUS_PROOF_MODE: "0",
      DINKUS_LAUNCH_INDEXABLE: "0",
      DINKUS_EMDASH_ADMIN_ENABLED: adminEnabled,
      EMDASH_SITE_URL: siteUrl.origin,
      DINKUS_REGISTRY_ACCESS_ENABLED: accessOptions ? "1" : "0",
      ...(accessOptions ? { DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN: accessOptions.teamDomain } : {}),
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
    DINKUS_WRANGLER_CONFIG: configRelativePath,
    // A Registry store installs Commerce from the Registry itself; it never bundles the paired build.
    DINKUS_PAIRED_COMMERCE_DIR: "" };
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
      const source = assertBuildSource(process.env);
      if (source && !source.providerCommitStamp.matchesCheckout) {
        console.error("Workers Builds commit stamp is unqualified; source verified from the clean Git checkout.");
      }
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
      const receipt = { ...(source ? { source } : {}), status, config: configRelativePath, profile: "shipping", adminEnabled: config.vars.DINKUS_EMDASH_ADMIN_ENABLED === "1", deployed: false };
      console.log(args.includes("--json") ? JSON.stringify(receipt) : `Registry ${status}: ${configRelativePath}; no deployment performed.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
