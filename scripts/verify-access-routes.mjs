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
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const commerceRoot = resolve(root, ".artifacts/source-deps/commerce");
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
    values.set(match[1], match[2]);
  }
  return values;
}

function deriveCommerceRoutes() {
  const source = readFileSync(commercePlugin, "utf8");
  const routesStart = source.indexOf("routes:");
  if (routesStart < 0) throw new Error("Commerce plugin has no routes object");
  const routes = balancedObject(source, source.indexOf("{", routesStart));
  const values = new Map();
  for (const file of ["src/features/catalog/public.ts", "src/features/catalog/route-ids.ts", "src/features/checkout/route-ids.ts", "src/features/storefront-availability/route-ids.ts"]) {
    try {
      for (const [name, value] of constants(readFileSync(resolve(commerceRoot, file), "utf8"))) values.set(name, value);
    } catch {
      // Older paired artifacts may not have every optional route-id module.
    }
  }
  const properties = [...routes.matchAll(/^\s{4}(?:\[([A-Z][A-Z0-9_]*)\]|([a-z][\w-]*))\s*:/gmu)];
  const result = [];
  for (let index = 0; index < properties.length; index += 1) {
    const match = properties[index];
    const next = properties[index + 1]?.index ?? routes.length;
    const name = match[1] ? values.get(match[1]) ?? `UNRESOLVED:${match[1]}` : match[2];
    const declaration = routes.slice(match.index, next);
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
  }));
}

function wildcardBypassExists() {
  const pluginPrefix = "/_emdash/api/plugins/";
  const forbidden = [pluginPrefix + "*", pluginPrefix + "<plugin>/*", pluginPrefix + "{plugin}/*"];
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer" });
  if (listed.status !== 0) throw new Error("could not enumerate tracked files");
  return listed.stdout.toString().split("\0").filter(Boolean).some((file) => {
    const text = readFileSync(resolve(root, file), "utf8");
    return forbidden.some((pattern) => text.includes(pattern));
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
const undeclared = all.filter((route) => route.public === null);
const publicRoutes = all.filter((route) => route.public === true);
const wildcard = wildcardBypassExists();
const policy = {
  checkoutDisabled: { bypasses: [] },
  checkoutEnabled: {
    bypasses: publicRoutes.map(({ path, methods, surface = "registry" }) => ({ path, methods, surface })),
  },
  commerce: { routes: commerce, publicRoutes: commerce.filter((route) => route.public === true).map((route) => route.path) },
  payments: { routes: payments, publicRoutes: payments.filter((route) => route.public === true).map((route) => route.path) },
  undeclaredRoutes: undeclared.map((route) => route.path),
  wildcardPluginBypass: wildcard,
};

if (format === "markdown") {
  console.log("# Generated Access route policy\n\n");
  console.log("Checkout off: no `/_emdash` exceptions.\n\nCheckout on: exact public routes derived from plugin code:\n\n");
  console.log("| Surface | Method | Exact path | Authentication declaration |\n| --- | --- | --- | --- |\n");
  for (const route of publicRoutes) console.log(`| ${route.surface ?? "registry"} | ${route.methods.join(", ") || "declared"} | \`${route.path}\` | public |\n`);
  for (const route of undeclared) console.log(`| blocked | ${route.methods.join(", ") || "unknown"} | \`${route.path}\` | **missing declaration** |\n`);
}

if (format === "json") console.log(JSON.stringify(policy, null, 2));
if (check && (wildcard || undeclared.length > 0)) {
  if (wildcard) fail("a wildcard plugin bypass is present");
  if (undeclared.length) fail(`route(s) lack an explicit public/admin declaration: ${undeclared.map((route) => route.path).join(", ")}`);
}
