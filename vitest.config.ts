import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/mocks/cloudflare-workers.ts", import.meta.url),
      ),
      "@dinkuskit/commerce/features/checkout": fileURLToPath(
        new URL("./.artifacts/source-deps/commerce/src/features/checkout/index.ts", import.meta.url),
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
      "@dinkuskit/commerce/features/customers": fileURLToPath(
        new URL("./.artifacts/source-deps/commerce/src/features/customers/index.ts", import.meta.url),
      ),
      "@dinkuskit/commerce/features/orders": fileURLToPath(
        new URL("./.artifacts/source-deps/commerce/src/features/orders/index.ts", import.meta.url),
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
