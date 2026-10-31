import { ensurePairedCommerceBuild } from "./lib/paired-commerce.mjs";

// Fetches and builds the pinned Commerce's Registry bundle once per commit (scripts/lib/paired-commerce.mjs),
// for pnpm dev, the proof store the browser tests use, the demo build and the paired proof. Prints the directory.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/prepare-paired-commerce.mjs\nBuilds the Commerce Registry bundle package.json pins under .artifacts/paired-commerce/<commit>, or uses DINKUS_PAIRED_COMMERCE_DIR as built.");
} else {
  try {
    ensurePairedCommerceBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
