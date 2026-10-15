import { fileURLToPath } from "node:url";

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

import { commerceProfileDefine } from "./src/features/commerce-profile/profiles.mjs";

const isCloudflare =
  process.env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
  process.env.ASTRO_ADAPTER === "cloudflare";

const commerceEntry = fileURLToPath(
  new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
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

const enableLocalStockManagement =
  !isCloudflare &&
  process.env.DINKUS_PROOF_MODE === "1" &&
  process.env.DINKUS_STOREFRONT_PROFILE === "proof";

const siteUrl = process.env.EMDASH_SITE_URL?.trim() || undefined;
const accessOptions = selectedRegistryAccessOptions(process.env);

// EmDash 1.2.0's sandbox() only reads the default Wrangler file. Keep a
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
      plugins: [
        {
          id: "dinkus-template-product-urls",
          version: "1.0.0",
          entrypoint: productUrlEntry,
        },
        ...(process.env.DINKUS_CATALOG_PROFILE === "native-development" ? [
          dinkusCommerce({
            enableLocalStockManagement,
            ...(siteUrl ? { siteUrl } : {}),
          }),
        ] : []),
      ],
    }),
  ],
  vite: {
    define: commerceProfileDefine(process.env),
    resolve: {
      alias: {
        "@dinkuskit/commerce/features/checkout": fileURLToPath(
          new URL(
            "./.artifacts/source-deps/commerce/src/features/checkout/index.ts",
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
