import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { playgroundDatabase } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

const productUrlEntry = fileURLToPath(
  new URL("./src/features/product-url-plugin/index.ts", import.meta.url),
);

export default defineConfig({
  output: "server",
  trailingSlash: "never",
  adapter: cloudflare({ configPath: "./wrangler.playground.jsonc" }),
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
      ],
    }),
  ],
  devToolbar: { enabled: false },
});
