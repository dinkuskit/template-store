import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { dinkusCommerce } from "./.artifacts/source-deps/commerce/src/index.ts";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { access, d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { unstable_readConfig } from "wrangler";
import { selectedRegistryAccessOptions } from "./scripts/registry-access.mjs";
import { selectedRegistrySandboxRunner } from "./scripts/registry-sandbox.mjs";

import { commerceProfile, commerceProfileDefine } from "./src/features/commerce-profile/profiles.mjs";

const isCloudflare =
  process.env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
  process.env.ASTRO_ADAPTER === "cloudflare";

const commerceEntry = fileURLToPath(
  new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
);
const playgroundCommerceEntry = fileURLToPath(
  new URL("./src/features/playground-checkout/commerce-entry.ts", import.meta.url),
);
const productUrlEntry = fileURLToPath(
  new URL("./src/features/product-url-plugin/index.ts", import.meta.url),
);
const inventoryEntry = fileURLToPath(
  new URL("./node_modules/@dinkuskit/inventory/src/index.ts", import.meta.url),
);
const databaseUrl =
  process.env.DINKUS_TEMPLATE_DB_URL ?? "file:./.artifacts/dev/content.db";
const uploadsDirectory =
  process.env.DINKUS_TEMPLATE_UPLOADS_DIR ?? "./.artifacts/dev/uploads";
const artifactSlotMatch = databaseUrl.match(
  /^\.?\/?(?:file:\.?\/?)?\.artifacts\/([a-z0-9_-]+)\//iu,
);
const viteCacheDir = artifactSlotMatch
  ? `.artifacts/${artifactSlotMatch[1]}/vite-cache`
  : "node_modules/.vite";

const enableLocalStockManagement =
  !isCloudflare &&
  process.env.DINKUS_PROOF_MODE === "1" &&
  process.env.DINKUS_STOREFRONT_PROFILE === "proof";

const siteUrl = process.env.EMDASH_SITE_URL?.trim() || undefined;

// Proof only: a local store that installs a built Commerce Registry bundle the way a Registry store does,
// under the selected profile's runtime id (scripts/verify-paired-product-on-sale.mjs).
const pairedCommerceDir = !isCloudflare && process.env.DINKUS_PAIRED_COMMERCE_DIR;
const pairedCommerce = pairedCommerceDir
  ? {
      ...(await import(pathToFileURL(resolve(pairedCommerceDir, "dist/sandbox/index.mjs")).href)).default,
      id: commerceProfile(process.env.DINKUS_COMMERCE_PROFILE).runtimeId,
      entrypoint: resolve(pairedCommerceDir, "dist/sandbox/plugin.mjs"),
    }
  : undefined;
const accessOptions = selectedRegistryAccessOptions(process.env);

// EmDash 1.4.0's sandbox() only reads the default Wrangler file. Keep a
// dedicated deployment's runner aligned with the adapter's selected config.
function cloudflareSandbox() {
  if (!process.env.DINKUS_WRANGLER_CONFIG) return sandbox();
  const config = unstable_readConfig({
    config: process.env.DINKUS_WRANGLER_CONFIG,
    ...(process.env.CLOUDFLARE_ENV ? { env: process.env.CLOUDFLARE_ENV } : {}),
  }, { hideWarnings: true });
  if (!config.worker_loaders?.some(({ binding }) => binding === "LOADER")) {
    if (config.vars?.DINKUS_CATALOG_PROFILE === "native-development") return undefined;
    throw new Error("The selected Cloudflare config must provide LOADER for Registry plugins.");
  }
  return selectedRegistrySandboxRunner(process.env) ?? "@emdash-cms/cloudflare/sandbox";
}

export default defineConfig({
  output: "server",
  trailingSlash: "never",
  adapter: isCloudflare
    ? cloudflare({
        ...(process.env.DINKUS_WRANGLER_CONFIG
          ? { configPath: process.env.DINKUS_WRANGLER_CONFIG }
          : {}),
      })
    : node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: isCloudflare
        ? d1({ binding: "DB" })
        : sqlite({ url: databaseUrl }),
      storage: isCloudflare
        ? r2({ binding: "MEDIA" })
        : local({
            directory: uploadsDirectory,
            baseUrl: "/_emdash/api/media/file",
          }),
      ...(siteUrl ? { siteUrl } : {}),
      ...(accessOptions ? { auth: access(accessOptions) } : {}),
      ...(isCloudflare ? { sandboxRunner: cloudflareSandbox() } : {}),
      ...(pairedCommerce ? { sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox", sandboxed: [pairedCommerce] } : {}),
      plugins: [
        {
          id: "dinkus-template-product-urls",
          version: "1.0.0",
          entrypoint: productUrlEntry,
        },
        ...(process.env.DINKUS_CATALOG_PROFILE === "native-development" ? [
          {
            ...dinkusCommerce({
              enableLocalStockManagement,
              ...(siteUrl ? { siteUrl } : {}),
            }),
            entrypoint: playgroundCommerceEntry,
          },
        ] : []),
      ],
    }),
  ],
  vite: {
    cacheDir: viteCacheDir,
    define: commerceProfileDefine(process.env),
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: {
      watch: {
        ignored: [
          "**/.artifacts/**",
          "**/.astro/**",
          "**/dist/**",
          "**/runs/**",
          "**/test-results/**",
        ],
      },
    },
    resolve: {
      alias: {
        "@dinkuskit/commerce/features/checkout": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/checkout/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/features/customers": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/customers/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/features/orders": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/orders/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/features/structured-data": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/structured-data/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/features/feeds": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/feeds/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/features/store-policies": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/store-policies/index.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce/admin": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/admin/native.ts",
            import.meta.url,
          ),
        ),
        "@dinkuskit/commerce": commerceEntry,
        "@dinkuskit/inventory": inventoryEntry,
      },
    },
  },
  devToolbar: { enabled: false },
});
