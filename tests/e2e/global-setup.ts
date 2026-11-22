import { request } from "@playwright/test";

/**
 * Wait for the proof store's demo catalog before any test starts.
 *
 * The demo seed runs on a signed-in request (src/middleware.ts). A fresh
 * store builds Commerce's unique indexes on its first requests, so the first
 * attempts are refused ("catalog commandId unique index inactive") and the
 * seed is tried again on the next signed-in request. When every browser test
 * ran in one job, the first admin test made those requests, and every later
 * test found a seeded store. CI now splits the tests into shards, each with
 * its own fresh store, so a shard may start with a test that makes only one
 * signed-in request. Each shard therefore starts the way the whole run used
 * to: signed-in requests until the home page lists the first demo product as
 * in stock, which means Commerce accepted the seed.
 *
 * Only the proof store seeds; the shipping store never does.
 */
const SEED_BUDGET_MS = 180_000;
const FIRST_DEMO_PRODUCT = "Dinkus Demo Heavyweight T-Shirt";

function demoCatalogReady(html: string): boolean {
  return html.split("<a ").some((anchor) =>
    anchor.includes("data-product-link") &&
    anchor.includes(FIRST_DEMO_PRODUCT) &&
    anchor.includes('data-commerce-availability="in-stock"')
  );
}

export default async function globalSetup(): Promise<void> {
  const baseURL = `http://127.0.0.1:${process.env.DINKUS_E2E_PORT ?? "4637"}`;
  const context = await request.newContext({ baseURL });
  try {
    const deadline = Date.now() + SEED_BUDGET_MS;
    for (;;) {
      const signedIn = await context.get("/_emdash/api/setup/dev-bypass");
      if (signedIn.ok()) {
        const home = await context.get("/");
        if (home.ok() && demoCatalogReady(await home.text())) return;
      }
      if (Date.now() > deadline) {
        throw new Error(`The proof store's demo catalog was not seeded within ${SEED_BUDGET_MS / 1000}s`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  } finally {
    await context.dispose();
  }
}
