import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const verifySite = resolve(root, "bin/verify-site");

function html(links) {
  return `<!doctype html><html><head><title>fixture</title></head><body>${links
    .map((href) => `<a href="${href}">link</a>`)
    .join("")}</body></html>`;
}

function listen(handler) {
  return new Promise((resolveListen, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected a TCP address"));
        return;
      }
      resolveListen({ server, origin: `http://127.0.0.1:${address.port}` });
    });
    server.on("error", reject);
  });
}

async function runVerifier(origin) {
  try {
    const result = await execFileAsync(process.execPath, [verifySite, origin], {
      cwd: root,
      env: {
        ...process.env,
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1",
      },
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error;
    return {
      status: failed.code ?? 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

test("drains a nested internal link discovered on a child page and can fail on it", async () => {
  const fetched = [];
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    fetched.push(url.pathname);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(["/child"]));
      return;
    }
    if (url.pathname === "/home") {
      res.writeHead(302, { location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/child") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(["/nested-missing"]));
      return;
    }
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
      return;
    }
    if (url.pathname === "/nested-missing") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const result = await runVerifier(origin);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /\/nested-missing returned 404/);
    assert.equal(fetched.includes("/nested-missing"), true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("rewrites loopback sitemap child locs onto the verifier origin", async () => {
  const fetched = [];
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    fetched.push(url.pathname);
    const port = new URL(origin).port;
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html([]));
      return;
    }
    if (url.pathname === "/home") {
      res.writeHead(302, { location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://localhost:${port}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
      );
      return;
    }
    if (url.pathname === "/sitemap-pages.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
      );
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const result = await runVerifier(origin);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Sitemap availability/);
    assert.equal(fetched.includes("/sitemap-pages.xml"), true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("skips an empty sitemap index on this starter", async () => {
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html([]));
      return;
    }
    if (url.pathname === "/home") {
      res.writeHead(302, { location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`,
      );
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const result = await runVerifier(origin);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SKIP Sitemap contract/);
    assert.doesNotMatch(result.stdout, /FAIL Sitemap XML/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
