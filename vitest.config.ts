import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/mocks/cloudflare-workers.ts", import.meta.url),
      ),
      "@dinkuskit/commerce": fileURLToPath(
        new URL("./.artifacts/source-deps/commerce/src/index.ts", import.meta.url),
      ),
      "@dinkuskit/inventory": fileURLToPath(
        new URL("./node_modules/@dinkuskit/inventory/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@astrojs/cloudflare", "@emdash-cms/cloudflare"],
      },
    },
  },
});
