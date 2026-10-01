import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { dinkusCommerce } from "./.artifacts/source-deps/commerce/src/index.ts";
import { dinkusBlocks } from "@dinkuskit/blocks";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

const commerceEntry = fileURLToPath(
  new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
);
const inventoryEntry = fileURLToPath(
  new URL("./node_modules/@dinkuskit/inventory/src/index.ts", import.meta.url),
);
const databaseUrl =
  process.env.DINKUS_TEMPLATE_DB_URL ?? "file:./.artifacts/dev/content.db";
const uploadsDirectory =
  process.env.DINKUS_TEMPLATE_UPLOADS_DIR ?? "./.artifacts/dev/uploads";

const enableLocalStockManagement =
  process.env.DINKUS_PROOF_MODE === "1" &&
  process.env.DINKUS_STOREFRONT_PROFILE === "proof";

const siteUrl = process.env.EMDASH_SITE_URL?.trim() || undefined;

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: databaseUrl }),
      storage: local({
        directory: uploadsDirectory,
        baseUrl: "/_emdash/api/media/file",
      }),
      ...(siteUrl ? { siteUrl } : {}),
      plugins: [
        dinkusBlocks(),
        dinkusCommerce({
          enableLocalStockManagement,
          ...(siteUrl ? { siteUrl } : {}),
        }),
      ],
    }),
  ],
  vite: {
    resolve: {
      alias: {
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
