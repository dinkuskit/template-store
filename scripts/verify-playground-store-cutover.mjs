/**
 * Real-HTTP proof for the playground's switch to Commerce's Registry build (playground-commerce-in-store-20261031):
 * a visitor store made by the playground before the switch, still within its hour, starts over on a fresh store
 * (Ronald, 1 Nov 2026) instead of showing a fresh demo shop over Commerce data the Registry build cannot see.
 *
 * It builds the earlier playground (DINKUS_PLAYGROUND_CUTOVER_FROM, by default main just before the switch) in a
 * worktree, makes a visitor store on it, then serves this checkout's build on the same visitor databases and replays
 * that visitor's cookie. Pass --no-build to reuse this checkout's current playground build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPlaygroundWorker,
  PLAYGROUND_PROOF_SITE,
  startPlaygroundVisitor,
  startPlaygroundWorker,
} from "./lib/playground-worker-proof.mjs";

const root = resolve(import.meta.dirname, "..");
const from = process.env.DINKUS_PLAYGROUND_CUTOVER_FROM ?? "74a31c25e64080d84af84397069a919511d222c5";
const artifact = resolve(root, ".artifacts/playground-cutover-proof");
const worktree = join(artifact, "from");
const persistTo = join(artifact, "state");
const port = 4399;
const step = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
};

spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
rmSync(artifact, { recursive: true, force: true });
mkdirSync(artifact, { recursive: true });
const results = {};
try {
  // The earlier playground, built from its own commit and lockfile.
  step("git", ["worktree", "add", "--detach", worktree, from], root);
  step("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], worktree);
  step(process.execPath, ["scripts/prepare-source-deps.mjs"], worktree);
  step(process.execPath, ["scripts/prepare-playground-plugins.mjs"], worktree);
  buildPlaygroundWorker({ skip: false, cwd: worktree });
  if (!existsSync(join(worktree, "dist/server/wrangler.json"))) throw new Error("the earlier playground did not build");

  let server = await startPlaygroundWorker({ name: "cutover-before", port, persistTo, vars: {}, buildDir: join(worktree, "dist/server") });
  const before = await startPlaygroundVisitor(server.base, "203.0.113.70", server.output);
  // The earlier playground's native Commerce answers under its own plugin id.
  const nativeCatalog = await fetch(`${server.base}/_emdash/api/plugins/dinkus-commerce/catalog/public`, { headers: { cookie: before.cookie } });
  const nativeProducts = (await nativeCatalog.json().catch(() => null))?.data?.products ?? [];
  results.before = { catalogGuidance: before.home.match(/data-catalog-guidance-state="([a-z]+)"/)?.[1] ?? null, nativeProducts: nativeProducts.length };
  await server.stop();

  // This checkout's playground, on the same visitor databases.
  buildPlaygroundWorker();
  server = await startPlaygroundWorker({ name: "cutover-after", port, persistTo, vars: {} });
  const api = await fetch(`${server.base}/_emdash/api/plugins/r_gshdrqaldna3r7sn/admin`, {
    method: "POST", redirect: "manual",
    headers: { cookie: before.cookie, origin: PLAYGROUND_PROOF_SITE, "content-type": "application/json", "x-emdash-request": "1" },
    body: JSON.stringify({ type: "page_load", page: "/settings" }),
  });
  results.oldVisitorApi = { status: api.status, code: (await api.json().catch(() => null))?.error?.code ?? null, clearsCookie: /^emdash_playground=; Max-Age=0/.test(api.headers.get("set-cookie") ?? "") };
  const page = await fetch(`${server.base}/`, { headers: { cookie: before.cookie, "cf-connecting-ip": "203.0.113.70" }, redirect: "manual" });
  results.oldVisitorPage = { status: page.status, location: page.headers.get("location"), clearsCookie: /^emdash_playground=; Max-Age=0/.test(page.headers.get("set-cookie") ?? "") };
  // The visitor's next click lands on a fresh store, seeded through the Registry build.
  const after = await startPlaygroundVisitor(server.base, "203.0.113.70", server.output);
  const registryCatalog = await fetch(`${server.base}/_emdash/api/plugins/r_gshdrqaldna3r7sn/catalog/public`, { headers: { cookie: after.cookie } });
  results.freshStore = {
    newSession: after.cookie !== before.cookie,
    catalogGuidance: after.home.match(/data-catalog-guidance-state="([a-z]+)"/)?.[1] ?? null,
    registryProducts: ((await registryCatalog.json().catch(() => null))?.data?.products ?? []).length,
  };
  // A second request on the fresh store is served normally (it is not mistaken for an earlier one).
  const again = await fetch(`${server.base}/`, { headers: { cookie: after.cookie }, redirect: "manual" });
  results.freshStoreAgain = { status: again.status };
  await server.stop();
} finally {
  spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "inherit" });
}

writeFileSync(join(artifact, "results.json"), JSON.stringify({ from, ...results }, null, 2) + "\n");
console.log(JSON.stringify({ from, ...results }, null, 2));
const failures = [];
if (!(results.before?.nativeProducts > 0)) failures.push("the earlier playground's store had no native Commerce products");
if (!(results.oldVisitorApi?.status === 409 && results.oldVisitorApi.code === "PLAYGROUND_RESTARTED" && results.oldVisitorApi.clearsCookie)) failures.push(`old visitor API call: ${JSON.stringify(results.oldVisitorApi)}`);
if (!(results.oldVisitorPage?.status === 302 && results.oldVisitorPage.location === "/playground" && results.oldVisitorPage.clearsCookie)) failures.push(`old visitor page load: ${JSON.stringify(results.oldVisitorPage)}`);
if (!(results.freshStore?.newSession && results.freshStore.catalogGuidance === "ready" && results.freshStore.registryProducts > 0)) failures.push(`fresh store: ${JSON.stringify(results.freshStore)}`);
if (results.freshStoreAgain?.status !== 200) failures.push(`fresh store second request: ${JSON.stringify(results.freshStoreAgain)}`);
if (failures.length) throw new Error(`playground store cutover proof failed:\n${failures.join("\n")}`);
console.log("PASS_PLAYGROUND_STORE_CUTOVER");
process.exit(0);
