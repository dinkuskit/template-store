import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PAIRED_REVIEWS_DIR_ENV,
  REVIEWS_REGISTRY_RUNTIME_ID,
  hasReviewsBuild,
  pairedReviewsDefaultDir,
  pairedReviewsDescriptor,
  pairedReviewsPin,
  resolvePairedReviewsDir,
} from "../../scripts/lib/paired-reviews.mjs";

const PIN = { repository: "https://github.com/dinkuskit/reviews.git", commit: "d6d2133bd4824e474e3002787c34f150ea662f24" };

function project(pin = PIN) {
  const root = mkdtempSync(join(tmpdir(), "paired-reviews-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", dinkuskit: { sourcePins: { reviews: pin } } }));
  return root;
}
function build(dir) {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist/plugin.mjs"), "export default {};\n");
  writeFileSync(join(dir, "dist/index.mjs"), "export default { id: 'dinkus-reviews', version: '0.0.0', capabilities: [] };\n");
}

test("the pin is package.json's exact Reviews commit in the public repository", () => {
  const root = project();
  try {
    assert.deepEqual(pairedReviewsPin(root), PIN);
    assert.equal(pairedReviewsDefaultDir(PIN, root), join(root, ".artifacts/paired-reviews", PIN.commit));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const bad of [{ ...PIN, repository: "https://example.invalid/reviews.git" }, { ...PIN, commit: "d6d2133" }, null]) {
    const broken = project(bad);
    try {
      assert.throws(() => pairedReviewsPin(broken), /sourcePins\.reviews/);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  }
  // The template's own pin is well formed.
  assert.match(pairedReviewsPin().commit, /^[0-9a-f]{40}$/u);
});

test("the mounted Reviews is the developer's checkout, else the pin's build, else none", async () => {
  const root = project();
  try {
    assert.equal(resolvePairedReviewsDir({}, root), null);
    const built = pairedReviewsDefaultDir(PIN, root);
    build(built);
    assert.equal(hasReviewsBuild(built), true);
    assert.equal(resolvePairedReviewsDir({}, root), built);
    assert.equal(resolvePairedReviewsDir({ [PAIRED_REVIEWS_DIR_ENV]: "" }, root), null);
    const mine = join(root, "my-reviews");
    assert.throws(() => resolvePairedReviewsDir({ [PAIRED_REVIEWS_DIR_ENV]: mine }, root), /npm run build/);
    build(mine);
    assert.equal(resolvePairedReviewsDir({ [PAIRED_REVIEWS_DIR_ENV]: mine }, root), mine);
    // The store runs it under Reviews' Registry id, the id a store that installed it from the Registry uses.
    const descriptor = await pairedReviewsDescriptor(mine);
    assert.equal(descriptor.id, REVIEWS_REGISTRY_RUNTIME_ID);
    assert.equal(descriptor.entrypoint, join(mine, "dist/plugin.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the page and the proof store name the same Reviews id", () => {
  const page = readFileSync(resolve(import.meta.dirname, "../../src/features/review-form/index.ts"), "utf8");
  assert.ok(page.includes(`"${REVIEWS_REGISTRY_RUNTIME_ID}"`));
});
