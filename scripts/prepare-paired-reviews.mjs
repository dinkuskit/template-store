import { ensurePairedReviewsBuild } from "./lib/paired-reviews.mjs";

// Fetches and builds the pinned DinkusKit Reviews once per commit (scripts/lib/paired-reviews.mjs) for the
// proof store the browser tests use. Prints the directory.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/prepare-paired-reviews.mjs\nBuilds the Reviews bundle package.json pins under .artifacts/paired-reviews/<commit>, or uses DINKUS_PAIRED_REVIEWS_DIR as built.");
} else {
  try {
    ensurePairedReviewsBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
