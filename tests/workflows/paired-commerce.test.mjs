import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PAIRED_COMMERCE_DIR_ENV,
  hasRegistryBuild,
  pairedCommerceDefaultDir,
  pairedCommercePin,
  pairedCommerceProfile,
  resolvePairedCommerceDir,
} from "../../scripts/lib/paired-commerce.mjs";

const PIN = { repository: "https://github.com/dinkuskit/commerce.git", tag: "v0.7.0-beta.4", commit: "b3494cbcb932680c16dda0bebc6a6ffd68456a4d" };

function project(pin = PIN) {
  const root = mkdtempSync(join(tmpdir(), "paired-commerce-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", dinkuskit: { sourcePins: { commerce: pin } } }));
  return root;
}
function build(dir) {
  mkdirSync(join(dir, "dist/sandbox"), { recursive: true });
  writeFileSync(join(dir, "dist/sandbox/plugin.mjs"), "export default {};\n");
  writeFileSync(join(dir, "dist/sandbox/index.mjs"), "export default {};\n");
}

test("the pin is package.json's exact Commerce commit, and its tag names the Registry package", () => {
  const root = project();
  try {
    assert.deepEqual(pairedCommercePin(root), PIN);
    assert.equal(pairedCommerceProfile(PIN), "beta");
    assert.equal(pairedCommerceProfile({ ...PIN, tag: "v0.7.0" }), "stable");
    assert.equal(pairedCommerceDefaultDir(PIN, root), join(root, ".artifacts/paired-commerce", PIN.commit));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const bad of [{ ...PIN, repository: "https://example.invalid/commerce.git" }, { ...PIN, commit: "b3494cb" }, { ...PIN, tag: "main" }]) {
    const broken = project(bad);
    try {
      assert.throws(() => pairedCommercePin(broken), /sourcePins\.commerce/);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  }
});

test("the mounted Commerce is the developer's checkout, else the pin's build, else none", () => {
  const root = project();
  try {
    // Nothing built yet: a store that mounts no Commerce, and a proof store that refuses to start.
    assert.equal(resolvePairedCommerceDir({}, root), null);
    // Set empty, the env means none even once the pin's build exists (a Registry store build).
    const built = pairedCommerceDefaultDir(PIN, root);
    build(built);
    assert.equal(hasRegistryBuild(built), true);
    assert.equal(resolvePairedCommerceDir({}, root), built);
    assert.equal(resolvePairedCommerceDir({ [PAIRED_COMMERCE_DIR_ENV]: "" }, root), null);
    // A developer's checkout is used as built, never rebuilt; an unbuilt one is refused with the fix.
    const own = join(root, "my-commerce");
    assert.throws(() => resolvePairedCommerceDir({ [PAIRED_COMMERCE_DIR_ENV]: own }, root), /npm run build/);
    build(own);
    assert.equal(resolvePairedCommerceDir({ [PAIRED_COMMERCE_DIR_ENV]: own }, root), own);
    assert.equal(resolvePairedCommerceDir({ [PAIRED_COMMERCE_DIR_ENV]: "my-commerce" }, root), own);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
