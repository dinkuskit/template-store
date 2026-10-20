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

function serveSvgIfProductImage(pathname, res) {
  if (/^\/(?:merch|images\/products)\/[a-z]+\.svg$/.test(pathname)) {
    res.writeHead(200, { "content-type": "image/svg+xml" });
    res.end("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"/>");
    return true;
  }
  return false;
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
    if (serveSvgIfProductImage(url.pathname, res)) return;
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
    if (serveSvgIfProductImage(url.pathname, res)) return;
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
    assert.match(result.stdout, /PASS Product images/);
    assert.equal(fetched.includes("/sitemap-pages.xml"), true);
    assert.equal(fetched.includes("/merch/tee.svg"), true);
    assert.equal(fetched.includes("/images/products/tote.svg"), true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("skips an empty sitemap index on this starter", async () => {
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (serveSvgIfProductImage(url.pathname, res)) return;
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

test("fails when a sitemap-listed URL redirects instead of serving a page", async () => {
  const fetched = [];
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    fetched.push(url.pathname);
    if (serveSvgIfProductImage(url.pathname, res)) return;
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
    if (url.pathname === "/old") {
      res.writeHead(302, { location: "/new", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/new") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html([]));
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
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/old</loc></url></urlset>`,
      );
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const result = await runVerifier(origin);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /listed in the sitemap but returned 302/);
    assert.equal(fetched.includes("/old"), true);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("fails when a seeded or demo product image returns 404 or a non-image content type", async () => {
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/images/products/tote.svg") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Route not found." }));
      return;
    }
    if (url.pathname === "/images/products/mug.svg") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>not an image</title>");
      return;
    }
    if (serveSvgIfProductImage(url.pathname, res)) return;
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
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL Product images — \/images\/products\/tote\.svg returned 404/);
    assert.match(result.stdout, /FAIL Product images — \/images\/products\/mug\.svg returned non-image Content-Type: text\/html/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("fails a commerce-linked page without Product JSON-LD and a missing feed", async () => {
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (serveSvgIfProductImage(url.pathname, res)) return;
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(["/products/linked", "/products/editorial"]));
      return;
    }
    if (url.pathname === "/home") {
      res.writeHead(302, { location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/products/linked") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><head><link rel=\"canonical\" href=\"" + origin + "/products/linked\"></head><body><article data-product-sku=\"HAT-1\"><h1>Hat</h1></article></body></html>");
      return;
    }
    if (url.pathname === "/products/editorial") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><head><link rel=\"canonical\" href=\"" + origin + "/products/editorial\"></head><body><h1>Preview</h1><script type=\"application/ld+json\">{\"@type\":\"Product\",\"name\":\"Preview\",\"url\":\"" + origin + "/products/editorial\"}</script></body></html>");
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
    res.writeHead(404).end();
  });
  try {
    const result = await runVerifier(origin);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /\/products\/linked shows SKU HAT-1 but has 0 Product JSON-LD block/);
    assert.match(result.stdout, /\/feeds\/google-merchant\.xml returned 404/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
