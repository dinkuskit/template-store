/**
 * The built playground Worker, served locally for HTTP proofs: `astro build` with the playground config, then
 * `wrangler dev` on the build, answering as https://playground.dinkuskit.com (Commerce's Connect needs an https
 * store). Each proof passes its own vars; the visitor databases persist in the proof's own directory, so a restart
 * keeps them.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "package.json"));
/** The project's own CLIs, run with this Node (no package-manager wrapper). */
const cli = (name, bin) => join(require.resolve(`${name}/package.json`), "..", bin);
const serverDir = join(root, "dist/server");
/** The store origin the Worker sees: wrangler dev forwards to the config's route over https. */
export const PLAYGROUND_PROOF_SITE = "https://playground.dinkuskit.com";

/** Builds the playground Worker (in `cwd`, this checkout by default) unless the caller asks to reuse the build. */
export function buildPlaygroundWorker({ skip = process.argv.includes("--no-build"), cwd = root } = {}) {
  if (skip) return;
  const built = spawnSync(process.execPath, [join(cwd, "node_modules/astro/bin/astro.mjs"), "build", "--config", "astro.playground.config.mjs"], {
    cwd, stdio: ["ignore", "inherit", "inherit"], env: process.env,
  });
  if (built.status !== 0) throw new Error(`playground build failed (${built.status})`);
}

const children = new Set();
process.on("exit", () => {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
});

/**
 * Serves the build in `buildDir` (this checkout's `dist/server` by default) on 127.0.0.1:`port` with the built
 * config's vars plus `vars` (a null value removes one), and appends its output to `log`. Returns the running server
 * with its output and a stop().
 */
export async function startPlaygroundWorker({ name, port, vars, persistTo, log = `${persistTo}-${name}.log`, buildDir = serverDir }) {
  const built = JSON.parse(readFileSync(join(buildDir, "wrangler.json"), "utf8"));
  const merged = { ...built.vars };
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const config = join(buildDir, `wrangler.${name}.json`);
  writeFileSync(config, JSON.stringify({ ...built, vars: merged }, null, 2));
  const child = spawn(process.execPath, [cli("wrangler", "bin/wrangler.js"), "dev", "--config", config, "--ip", "127.0.0.1", "--port", String(port),
    "--local-protocol", "http", "--upstream-protocol", "https", "--persist-to", persistTo], {
    cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" },
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  const output = [];
  const logStream = createWriteStream(log, { flags: "a" });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { output.push(String(chunk)); logStream.write(chunk); });
  }
  child.once("exit", () => logStream.end());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      const response = await fetch(`${base}/robots.txt`, { redirect: "manual" });
      if (response.status < 500) break;
    } catch {}
    if (i >= 240 || child.exitCode !== null) throw new Error(`playground Worker did not start\n${output.join("").slice(-4000)}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return {
    base,
    output,
    async stop() {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
      ]);
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      child.stdout?.destroy();
      child.stderr?.destroy();
    },
  };
}

/**
 * A fresh playground visitor: the loading page issues the session cookie and init creates the visitor's store.
 * The first page view seeds the demo store through Commerce's own routes.
 */
export async function startPlaygroundVisitor(base, ip, output = []) {
  const loading = await fetch(`${base}/playground`, { headers: { origin: PLAYGROUND_PROOF_SITE, "cf-connecting-ip": ip }, redirect: "manual" });
  const cookie = loading.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`playground loading page did not issue a session cookie (${loading.status})\n${output.join("").slice(-2000)}`);
  const init = await fetch(`${base}/_playground/init`, {
    method: "POST",
    headers: { origin: PLAYGROUND_PROOF_SITE, cookie, "cf-connecting-ip": ip, "content-type": "application/json" },
    body: "{}",
  });
  if (!init.ok) throw new Error(`playground init failed (${init.status}): ${(await init.text()).slice(0, 300)}`);
  const home = await fetch(`${base}/`, { headers: { cookie, "cf-connecting-ip": ip }, redirect: "manual" });
  if (!home.ok) throw new Error(`playground home failed (${home.status}): ${(await home.text()).slice(0, 300)}\n${output.join("").slice(-2000)}`);
  return { cookie, home: await home.text() };
}
