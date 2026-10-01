import { createRequire } from "node:module";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = createRequire(
  realpathSync(new URL("../node_modules/wrangler/package.json", import.meta.url)),
)("esbuild");
const outfile = resolve(root, ".artifacts/seed/seed-synthetic-demo.mjs");

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["scripts/seed-synthetic-demo.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "info",
  alias: {
    "@dinkuskit/commerce": resolve(
      root,
      ".artifacts/source-deps/commerce/src/index.ts",
    ),
  },
});

console.log(`seed bundle: ${outfile}`);
