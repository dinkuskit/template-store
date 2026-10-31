import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { access, d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { unstable_readConfig } from "wrangler";
import { selectedRegistryAccessOptions } from "./scripts/registry-access.mjs";
import { registrySandboxRunner, selectedRegistrySandboxRunner } from "./scripts/registry-sandbox.mjs";
import { pairedCommerceDescriptor, pairedCommercePin, pairedCommerceProfile, resolvePairedCommerceDir } from "./scripts/lib/paired-commerce.mjs";

import { commerceProfile, commerceProfileDefine } from "./src/features/commerce-profile/profiles.mjs";

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
const artifactSlotMatch = databaseUrl.match(
  /^\.?\/?(?:file:\.?\/?)?\.artifacts\/([a-z0-9_-]+)\//iu,
);
const viteCacheDir = artifactSlotMatch
  ? `.artifacts/${artifactSlotMatch[1]}/vite-cache`
  : "node_modules/.vite";

const siteUrl = process.env.EMDASH_SITE_URL?.trim() || undefined;

// Commerce runs one build, the Registry (sandboxed) one, everywhere (template-one-build-registry-20261031).
// The native copy's development profile is gone with it.
if (process.env.DINKUS_CATALOG_PROFILE === "native-development") {
  throw new Error(
    "DINKUS_CATALOG_PROFILE=native-development is retired: the store runs Commerce's Registry build " +
    "(pnpm prepare:commerce, or DINKUS_PAIRED_COMMERCE_DIR for a Commerce checkout you are building). Unset it.",
  );
}
// The Commerce this store mounts the way a Registry store installs it: the pin's Registry build, or the
// checkout a developer is building (scripts/lib/paired-commerce.mjs). A Registry store build mounts none;
// its owner installs Commerce from the Registry.
const pairedCommerceDir = resolvePairedCommerceDir(process.env);
// The build's package names the runtime id: a pre-release pin is the beta package, a release the stable one.
if (pairedCommerceDir && !process.env.DINKUS_COMMERCE_PROFILE) {
  process.env.DINKUS_COMMERCE_PROFILE = pairedCommerceProfile(pairedCommercePin());
}
const pairedCommerce = pairedCommerceDir
  ? await pairedCommerceDescriptor(pairedCommerceDir, commerceProfile(process.env.DINKUS_COMMERCE_PROFILE).runtimeId)
  : undefined;
const accessOptions = selectedRegistryAccessOptions(process.env);

// EmDash 1.4.0's sandbox() only reads the default Wrangler file. Keep a
// dedicated deployment's runner aligned with the adapter's selected config, and
// refuse to build a Worker that mounts Commerce without the Worker Loader it needs.
function cloudflareSandbox() {
  const configPath = process.env.DINKUS_WRANGLER_CONFIG ?? "wrangler.jsonc";
  const config = unstable_readConfig({
    config: configPath,
    ...(process.env.CLOUDFLARE_ENV ? { env: process.env.CLOUDFLARE_ENV } : {}),
  }, { hideWarnings: true });
  if (!config.worker_loaders?.some(({ binding }) => binding === "LOADER")) {
    if (pairedCommerce) throw new Error(`${configPath} must bind LOADER (worker_loaders) to run the paired Commerce Registry build.`);
    if (process.env.DINKUS_WRANGLER_CONFIG) throw new Error("The selected Cloudflare config must provide LOADER for Registry plugins.");
    return sandbox();
  }
  // Every Cloudflare host of the installed Commerce gets the Registry profile's subrequest budget
  // (registry-sandbox-budget-002): the demo mounts the same plugin.
  return selectedRegistrySandboxRunner(process.env) ?? (pairedCommerce ? registrySandboxRunner() : sandbox());
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
      // On Cloudflare the Worker Loader runs the installed plugins; on Node the workerd runner does, and
      // astro dev hands them to Miniflare (EmDash's documented loop: build the plugin, run the site).
      ...(isCloudflare ? { sandboxRunner: cloudflareSandbox() } : pairedCommerce ? { sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox" } : {}),
      ...(pairedCommerce ? { sandboxed: [pairedCommerce] } : {}),
      plugins: [
        {
          id: "dinkus-template-product-urls",
          version: "1.0.0",
          entrypoint: productUrlEntry,
        },
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
