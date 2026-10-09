#!/usr/bin/env node

/**
 * Derive the store's Cloudflare Access exceptions from plugin route code.
 *
 * This deliberately does not maintain a second hand-written path list. The
 * pinned Commerce source is prepared by `pnpm prepare:sources`; Payments can
 * supply its exported manifest with --payments-manifest when that artifact is
 * installed. Missing route declarations fail closed.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const commerceRoot = process.env.ACCESS_ROUTES_COMMERCE_ROOT
  ? resolve(process.env.ACCESS_ROUTES_COMMERCE_ROOT)
  : resolve(root, ".artifacts/source-deps/commerce");
const commercePlugin = resolve(commerceRoot, "src/plugin.ts");
const paymentsManifestArg = process.argv.find((value) => value.startsWith("--payments-manifest="));
const format = process.argv.includes("--format=markdown") ? "markdown" : "json";
const check = process.argv.includes("--check");

function fail(message) {
  console.error(`access-routes: ${message}`);
  process.exitCode = 1;
}

function balancedObject(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\" ) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error("unbalanced route object");
}

function constants(source) {
  const values = new Map();
  for (const match of source.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*["']([^"']+)["']/gu)) {
    if (values.has(match[1])) values.set(match[1], null);
    else values.set(match[1], match[2]);
  }
  return values;
}

function modulePath(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(join(from, specifier.replace(/\.js$/u, "")));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function importedConstants(file, seen = new Set()) {
  if (seen.has(file)) return new Map();
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const values = constants(source);
  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/gu)) {
    const target = modulePath(resolve(file, ".."), match[2]);
    if (!target) continue;
    const targetValues = importedConstants(target, seen);
    for (const item of match[1].split(",")) {
      const names = item.trim().match(/^([A-Z][A-Z0-9_]*)(?:\s+as\s+([A-Z][A-Z0-9_]*))?$/u);
      if (!names) continue;
      const [exported, local = exported] = names.slice(1);
      if (!targetValues.has(exported) || values.has(local)) values.set(local, null);
      else values.set(local, targetValues.get(exported));
    }
  }
  return values;
}

function pluginImports(source) {
  const bindings = new Map();
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/gu)) {
    for (const item of match[1].split(",")) {
      const names = item.trim().match(/^([A-Z][A-Z0-9_]*)(?:\s+as\s+([A-Z][A-Z0-9_]*))?$/u);
      if (!names) continue;
      const [imported, local = imported] = names.slice(1);
      bindings.set(local, { imported, specifier: match[2] });
    }
  }
  return bindings;
}

function deriveCommerceRoutes() {
  const source = readFileSync(commercePlugin, "utf8");
  const routesStart = source.indexOf("routes:");
  if (routesStart < 0) throw new Error("Commerce plugin has no routes object");
  const routes = balancedObject(source, source.indexOf("{", routesStart));
  // Resolve only bindings imported by the plugin. A filesystem-wide map lets
  // an unrelated module silently win when two modules export the same name.
  const values = new Map();
  for (const [local, { imported, specifier }] of pluginImports(source)) {
    const target = modulePath(resolve(commercePlugin, ".."), specifier);
    const targetValues = target ? importedConstants(target) : new Map();
    values.set(local, targetValues.has(imported) ? targetValues.get(imported) : null);
  }
  const properties = [...routes.matchAll(/^\s{4}(?:\[([A-Z][A-Z0-9_]*)\]|([a-z][\w-]*)|(["'])([^"']+)\3)\s*:/gmu)];
  const result = [];
  for (let index = 0; index < properties.length; index += 1) {
    const match = properties[index];
    const next = properties[index + 1]?.index ?? routes.length;
    const name = match[1] ? values.get(match[1]) ?? null : match[2] ?? match[4];
    const declaration = routes.slice(match.index, next);
    if (name === null) {
      result.push({ name: null, constant: match[1], path: null, public: null, methods: [] });
      continue;
    }
    const publicMatch = declaration.match(/\bpublic\s*:\s*(true|false)\b/u);
    const inheritedGuestRoute = declaration.includes("guestRoute(");
    const methods = declaration.match(/\bmethods\s*:\s*\[([^\]]*)\]/u)?.[1]
      ?.match(/["']([A-Z]+)["']/gu)?.map((method) => method.replace(/["']/gu, "")) ?? [];
    result.push({
      name,
      path: `/_emdash/api/plugins/dinkus-commerce/${name}`,
      public: publicMatch ? publicMatch[1] === "true" : inheritedGuestRoute ? true : null,
      methods: inheritedGuestRoute && methods.length === 0 ? ["POST"] : methods,
    });
  }
  return result;
}

function paymentsRoutes() {
  if (!paymentsManifestArg) return [];
  const path = paymentsManifestArg.slice("--payments-manifest=".length);
  const manifest = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  if (!Array.isArray(manifest.routes)) throw new Error("Payments manifest must contain routes[]");
  return manifest.routes.map((route) => ({
    name: route.name ?? route.path,
    path: route.path,
    public: typeof route.public === "boolean" ? route.public : null,
    methods: route.method ? [route.method] : route.methods ?? [],
    surface: route.surface ?? "registry",
    auth: route.auth ?? null,
    source: "payments",
  }));
}

const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

// Every bypass must be one exact, literal path. Manifest input is untrusted:
// a wildcard, placeholder or plugin-wide path must never reach Access.
function bypassProblem(route) {
  const { path, methods, surface } = route;
  if (typeof path !== "string" || !/^\/[A-Za-z0-9._~\/-]+$/u.test(path)) {
    return "path is not an exact literal path (wildcards, placeholders, queries and spaces are refused)";
  }
  if (path.includes("//") || path.endsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
    return "path is not a canonical exact path";
  }
  if (!Array.isArray(methods) || methods.length === 0 || methods.some((method) => !HTTP_METHODS.has(method))) {
    return "route must declare explicit HTTP methods";
  }
  if (surface === "registry") {
    if (!/^\/_emdash\/api\/plugins\/[a-z0-9-]+\/[^/]/u.test(path)) {
      return "registry route must be one exact route under a named plugin";
    }
    if (route.source === "payments" && !/^\/_emdash\/api\/plugins\/dinkus-payments\/[^/]/u.test(path)) {
      return "Payments registry route must belong to dinkus-payments";
    }
  } else if (surface === "hosted") {
    if (path.startsWith("/_emdash")) return "hosted route must not be an /_emdash path";
    if (route.source === "payments" && !(
      path === "/webhooks/stripe" ||
      /^\/webhooks\/authorize-net\/[A-Za-z0-9._~-]+$/u.test(path)
    )) {
      return "Payments hosted route is outside the documented provider webhook paths";
    }
  } else {
    return `unknown surface ${JSON.stringify(surface)}`;
  }
  if (route.source === "payments" && route.auth !== "provider-signature") {
    return "public Payments route must declare auth exactly as provider-signature";
  }
  return null;
}

function wildcardBypassExists() {
  const policyRoot = process.env.ACCESS_ROUTES_POLICY_ROOT
    ? resolve(process.env.ACCESS_ROUTES_POLICY_ROOT)
    : root;
  const policyFiles = ["DEPLOY.md", "wrangler.jsonc"];
  const wildcard = /\/_emdash\/api\/plugins\/(?:\*|(?:[a-z0-9-]+|<plugin>|\{plugin\})\/\*)/u;
  return policyFiles.some((file) => {
    const path = resolve(policyRoot, file);
    try {
      return wildcard.test(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
}

let commerce;
let payments;
try {
  commerce = deriveCommerceRoutes();
  payments = paymentsRoutes();
} catch (error) {
  fail(error.message);
  process.exit();
}

const all = [...commerce, ...payments];
const unresolved = commerce.filter((route) => route.path === null);
const undeclared = all.filter((route) => route.path !== null && route.public === null);
const invalid = all
  .filter((route) => route.public === true)
  .map((route) => ({ route, problem: bypassProblem({ surface: "registry", ...route }) }))
  .filter(({ problem }) => problem !== null);
const publicRoutes = all.filter((route) => route.public === true && !invalid.some(({ route: bad }) => bad === route));
const wildcard = wildcardBypassExists();
function commerceSourceCommit() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: commerceRoot, encoding: "utf8" });
  return head.status === 0 ? head.stdout.trim() : null;
}

// The Commerce side comes from a source checkout, never the artifact a store
// has installed, so this output is a review preview and not Access authority.
const policy = {
  authority: {
    kind: "source-pin",
    commerceSourceCommit: commerceSourceCommit(),
    deploymentReady: false,
    reason: "Commerce routes come from a source checkout; live Access rules need the installed Commerce route manifest with artifact identity (dinkuskit/commerce#79).",
  },
  checkoutDisabled: { bypasses: [] },
  checkoutEnabled: {
    bypasses: publicRoutes.map(({ path, methods, surface = "registry", auth }) => ({ path, methods, surface, ...(auth ? { auth } : {}) })),
  },
  commerce: { routes: commerce, publicRoutes: publicRoutes.filter((route) => route.source !== "payments").map((route) => route.path) },
  payments: { routes: payments, publicRoutes: publicRoutes.filter((route) => route.source === "payments").map((route) => route.path) },
  invalidPublicRoutes: invalid.map(({ route, problem }) => ({ path: route.path, problem })),
  undeclaredRoutes: undeclared.map((route) => route.path),
  unresolvedRouteIds: unresolved.map((route) => route.constant),
  wildcardPluginBypass: wildcard,
};

if (format === "markdown") {
  console.log("# Access route policy preview (source pin, not deployment authority)\n");
  console.log(`Commerce source commit: \`${policy.authority.commerceSourceCommit ?? "unknown"}\`. Do not apply these rows as live Access rules; checkout-on exceptions need the installed Commerce route manifest (dinkuskit/commerce#79).\n`);
  console.log("Checkout off: no `/_emdash` exceptions.\n\nCheckout on (preview): exact public routes derived from plugin source:\n");
  console.log("| Surface | Method | Exact path | Authentication declaration |\n| --- | --- | --- | --- |");
  for (const route of publicRoutes) console.log(`| ${route.surface ?? "registry"} | ${route.methods.join(", ")} | \`${route.path}\` | ${route.auth ? `public, ${route.auth}` : "public"} |`);
  for (const { route, problem } of invalid) console.log(`| blocked | ${(route.methods ?? []).join(", ") || "unknown"} | \`${String(route.path)}\` | **refused: ${problem}** |`);
  for (const route of undeclared) console.log(`| blocked | ${route.methods.join(", ") || "unknown"} | \`${route.path}\` | **missing declaration** |`);
  for (const route of unresolved) console.log(`| blocked | unknown | \`${route.constant}\` | **unresolved route id** |`);
}

if (format === "json") console.log(JSON.stringify(policy, null, 2));
if (check && (wildcard || undeclared.length > 0 || unresolved.length > 0 || invalid.length > 0)) {
  if (wildcard) fail("a wildcard plugin bypass is present");
  for (const { route, problem } of invalid) fail(`refused public route ${JSON.stringify(route.path)}: ${problem}`);
  if (unresolved.length) fail(`route id(s) could not be resolved: ${unresolved.map((route) => route.constant).join(", ")}`);
  if (undeclared.length) fail(`route(s) lack an explicit public/admin declaration: ${undeclared.map((route) => route.path).join(", ")}`);
}
