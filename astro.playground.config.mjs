import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { playgroundDatabase } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { dinkusCommerce } from "./.artifacts/source-deps/commerce/src/index.ts";

// The playground always serves the synthetic native catalog; the playground
// middleware seeds it into each per-visitor DB. Sandbox checkout stays closed
// unless DINKUS_CHECKOUT_ENABLED="1" and the Payments env and the trusted
// return origin (EMDASH_SITE_URL) are present; then the native Commerce plugin
// gets the playground's host-side Payments port.

const commerceEntry = fileURLToPath(
  new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
);
const playgroundCommerceEntry = fileURLToPath(
  new URL("./src/features/playground-checkout/commerce-entry.ts", import.meta.url),
);
const productUrlEntry = fileURLToPath(
  new URL("./src/features/product-url-plugin/index.ts", import.meta.url),
);

export default defineConfig({
  output: "server",
  trailingSlash: "never",
  adapter: cloudflare({
    configPath: process.env.DINKUS_PLAYGROUND_WRANGLER_CONFIG ?? "./wrangler.playground.jsonc",
  }),
  integrations: [
    react(),
    emdash({
      database: playgroundDatabase({ binding: "PLAYGROUND_DB" }),
      storage: {
        entrypoint: "@emdash-cms/cloudflare/db/playground",
        config: {},
      },
      // EmDash creates one SQLite-backed DO and anonymous admin per visitor.
      playground: {
        middlewareEntrypoint: "./src/playground-middleware.ts",
      },
      plugins: [
        {
          id: "dinkus-template-product-urls",
          version: "1.0.0",
          entrypoint: productUrlEntry,
        },
        // Commerce's own descriptor, served through the playground entry that
        // adds build-time checkout options (binding "playground", flat-rate
        // shipping, host-side Payments port). Commerce is unchanged.
        { ...dinkusCommerce({ enableLocalStockManagement: false }), entrypoint: playgroundCommerceEntry },
      ],
    }),
  ],
  vite: {
    resolve: {
      alias: {
        "@dinkuskit/commerce/features/checkout": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/checkout/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/features/customers": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/customers/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/features/orders": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/orders/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/features/structured-data": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/structured-data/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/features/feeds": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/feeds/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/features/store-policies": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/features/store-policies/index.ts", import.meta.url),
        ),
        "@dinkuskit/commerce/admin": fileURLToPath(
          new URL("./.artifacts/source-deps/commerce/src/admin/native.ts", import.meta.url),
        ),
        "@dinkuskit/commerce": commerceEntry,
      },
    },
  },
  devToolbar: { enabled: false },
});
