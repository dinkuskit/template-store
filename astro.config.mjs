import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { dinkusCommerce } from "./.artifacts/source-deps/commerce/src/index.ts";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { d1, r2 } from "@emdash-cms/cloudflare";

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
