import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { playgroundDatabase } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { pairedCommercePin, pairedCommerceProfile } from "./scripts/lib/paired-commerce.mjs";
import { commerceProfileDefine } from "./src/features/commerce-profile/profiles.mjs";
import { playgroundPluginManifest, playgroundRegistryPlugins } from "./src/features/playground-plugins/registry-plugins.mjs";

// The playground runs Commerce's Registry build, the one build Commerce keeps
// (template-one-build-registry-20261031), inside each visitor's store beside
// Payments and Ship, and seeds the synthetic demo catalog through Commerce's own
// routes. Its pretend DinkusKit connects Commerce and hands it the playground's
// checkout settings; sandbox checkout stays closed unless DINKUS_CHECKOUT_ENABLED="1"
// and the Payments env and the trusted return origin (EMDASH_SITE_URL) are present.

// The Commerce package the pin is (a release is the stable package), as the store's own config chooses it.
process.env.DINKUS_COMMERCE_PROFILE ??= pairedCommerceProfile(pairedCommercePin());

const commerceEntry = fileURLToPath(
  new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
);
const tourEntry = fileURLToPath(
  new URL("./src/features/playground-tour/tour-plugin.ts", import.meta.url),
);
const mailEntry = fileURLToPath(
  new URL("./src/features/playground-plugins/mail-plugin.ts", import.meta.url),
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
        // Playground-only tour: a card on the admin dashboard and its own admin page.
        {
          id: "dinkus-playground-tour",
          version: "1.0.0",
          entrypoint: tourEntry,
          adminWidgets: [{ id: "tour", size: "full", title: "Playground tour" }],
          adminPages: [{ path: "/tour", label: "Playground tour", icon: "compass" }],
        },
        // The playground's email provider: Commerce emails a shopper's sign-in code through it.
        { id: "dinkus-playground-mail", version: "1.0.0", entrypoint: mailEntry },
        // Commerce, Payments and Ship: their Registry bundles, run inside the
        // visitor's own store. EmDash's sandbox saves plugin data only to a
        // regular store database, never to a playground visitor's store.
        ...playgroundRegistryPlugins(),
      ],
    }),
  ],
  vite: {
    define: {
      ...commerceProfileDefine(process.env),
      // The seed builds the installed Commerce's storage indexes from its own Registry manifest.
      __PLAYGROUND_COMMERCE_STORAGE__: JSON.stringify(playgroundPluginManifest("commerce").storage ?? {}),
    },
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
