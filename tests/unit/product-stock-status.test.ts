import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("only dynamic variant availability is a server-rendered atomic status", () => {
  const page = readFileSync("src/pages/products/[id].astro", "utf8");
  const status = page.match(/<p\b[^>]*data-product-status[\s\S]*?<\/p>/)?.[0];
  expect(status).toContain('role={variantOptions.length ? "status" : undefined}');
  expect(status).toContain('aria-atomic={variantOptions.length ? "true" : undefined}');
  // Keep updating the pre-existing region rather than replacing it or moving focus.
  expect(page).toContain('status.textContent = view.status;');
  expect(status).not.toContain('tabindex');
  expect(status).not.toContain('"alert"');
});
