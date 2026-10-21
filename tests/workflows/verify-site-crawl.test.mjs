import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const verifySite = resolve(root, "bin/verify-site");

// Exercise the exact prepared Commerce builders, whose source imports use .js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".js") && context.parentURL?.includes("/.artifacts/source-deps/commerce/")) {
      return nextResolve(specifier.replace(/\.js$/u, ".ts"), context);
    }
    return nextResolve(specifier, context);
  },
});
const { buildGoogleMerchantFeed, buildMetaCatalogFeed } = await import("../../.artifacts/source-deps/commerce/src/features/feeds/builder.ts");

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

const EMPTY_GOOGLE_FEED = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel></channel></rss>';
const EMPTY_META_FEED = '"id","retailer_id","title","description","availability","condition","price","link","image_link","additional_image_link","brand","gtin","mpn","shipping"\n';

for (const scenario of [
  { name: 'healthy empty feeds with editorial pages', status: 200, editorial: true, pass: true },
  { name: 'healthy empty feeds with no product pages', status: 200, editorial: false, pass: true },
  { name: 'absent Commerce with editorial pages', status: 503, editorial: true, pass: true },
  { name: 'corrupt empty XML', status: 200, editorial: true, xml: '<rss><channel>broken', pass: false },
  { name: 'corrupt empty XML without product pages', status: 200, editorial: false, xml: '<rss><channel>broken', pass: false },
  { name: 'corrupt empty CSV', status: 200, editorial: true, csv: 'error,not a feed\n', pass: false },
  { name: 'wrong empty feed content type', status: 200, editorial: true, type: 'text/html', pass: false },
  { name: 'feed server error', status: 500, editorial: true, pass: false },
  { name: 'duplicate trailing slash feed', status: 200, editorial: true, slash: true, pass: false },
]) {
  test(`feed verification distinguishes ${scenario.name}`, async () => {
    const { server, origin } = await listen((req, res) => {
      const path = new URL(req.url ?? '/', origin).pathname;
      if (serveSvgIfProductImage(path, res)) return;
      if (path === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(html(scenario.editorial ? ['/products/editorial'] : []));
      if (path === '/home') return res.writeHead(302, { location: '/' }).end();
      if (path === '/robots.txt') return res.writeHead(200).end('User-agent: *\nAllow: /\n');
      if (path === '/sitemap.xml') return res.writeHead(200, { 'content-type': 'application/xml' })
        .end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url>${scenario.editorial ? `<url><loc>${origin}/products/editorial</loc></url>` : ''}</urlset>`);
      if (path === '/products/editorial') {
        return res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><link rel="canonical" href="${origin}${path}"><h1>Preview</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Preview', url: origin + path })}</script>`);
      }
      if (path === '/feeds/google-merchant.xml' || path === '/feeds/meta-catalog.csv' || (scenario.slash && /^\/feeds\/.+\/$/.test(path))) {
        const xml = path.includes('.xml');
        return res.writeHead(scenario.status, { 'content-type': scenario.type ?? (xml ? 'application/xml' : 'text/csv') })
          .end(scenario.status === 200 ? (xml ? scenario.xml ?? EMPTY_GOOGLE_FEED : scenario.csv ?? EMPTY_META_FEED) : 'Feed unavailable');
      }
      return res.writeHead(404).end();
    });
    try {
      const result = await runVerifier(origin);
      assert.equal(result.status === 0, scenario.pass, result.stdout + result.stderr);
      assert.match(result.stdout, scenario.pass ? /PASS Feeds/ : /FAIL Feeds/);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
}

for (const scenario of [
  { name: "actual Commerce XML and CSV with quotes, newlines, and escaped text", linked: true, pass: true },
  { name: "valid nonempty feeds without a discovered linked SKU", linked: false, pass: true },
  { name: "empty Commerce feeds when a linked product opted out", linked: true, optedOut: true, pass: true },
  { name: "truncated XML with a linked product", linked: true, xml: "<rss><channel>broken", pass: false },
  { name: "mismatched XML tags with a linked product", linked: true, xml: "<rss><channel></rss>", pass: false },
  { name: "a non-feed XML document with a linked product", linked: true, xml: "<error>Unavailable</error>", pass: false },
  { name: "unterminated CSV quoting with a linked product", linked: true, csv: EMPTY_META_FEED + '"unterminated', pass: false },
  { name: "a short CSV row with a linked product", linked: true, csv: EMPTY_META_FEED + '"id","short"\n', pass: false },
  { name: "an extra CSV column with a linked product", linked: true, csv: EMPTY_META_FEED + Array(15).fill('"field"').join(",") + "\n", pass: false },
  { name: "malformed nonempty CSV without a linked SKU", linked: false, csv: EMPTY_META_FEED + '"unterminated', pass: false },
  { name: "named ampersand SKU entity", linked: true, attribute: "A&amp;B", sku: "A&B", pass: true },
  { name: "quoted SKU entity", linked: true, attribute: "A&quot;B", sku: 'A"B', pass: true },
  { name: "decimal numeric SKU entity", linked: true, attribute: "A&#38;B", sku: "A&B", pass: true },
  { name: "hexadecimal numeric SKU entity", linked: true, attribute: "A&#x26;B", sku: "A&B", pass: true },
  { name: "apostrophe within a double-quoted SKU attribute", linked: true, attribute: "A'B", sku: "A'B", pass: true },
  { name: "a genuine decoded SKU mismatch", linked: true, attribute: "A&amp;B", sku: "DIFFERENT", pass: false, mismatch: true },
]) {
  test(`feed and SKU verification handles ${scenario.name}`, async () => {
    const { server, origin } = await listen((req, res) => {
      const path = new URL(req.url ?? "/", origin).pathname;
      if (serveSvgIfProductImage(path, res)) return;
      if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(html(["/products/linked"]));
      if (path === "/home") return res.writeHead(302, { location: "/" }).end();
      if (path === "/robots.txt") return res.writeHead(200).end("User-agent: *\nAllow: /\n");
      if (path === "/sitemap.xml") return res.writeHead(200, { "content-type": "application/xml" })
        .end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/products/linked</loc></url></urlset>`);
      if (path === "/products/linked") {
        const product = { "@type": "Product", name: "Bag", url: origin + path, ...(scenario.linked ? { sku: scenario.sku ?? "BAG-1" } : {}) };
        const attribute = scenario.linked ? `data-product-sku="${scenario.attribute ?? "BAG-1"}"` : "";
        return res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><link rel="canonical" href="${origin}${path}"><article ${attribute}><h1>Bag</h1></article><script type="application/ld+json">${JSON.stringify(product)}</script>`);
      }
      if (path === "/feeds/google-merchant.xml" || path === "/feeds/meta-catalog.csv") {
        const facts = [{
          product: { id: "bag", name: "Bag", sku: "BAG-1", price: { currency: "USD", minor: "1000" }, availability: { status: "in-stock", sellable: true, listable: true } },
          content: { canonicalUrl: `${origin}/products/linked`, title: 'Bag & "tag"', description: 'A quoted "bag", with\na newline & more.', imageUrls: [`${origin}/bag.jpg`] },
          eligibility: scenario.optedOut ? [] : ["google-merchant", "meta-catalog"],
        }];
        const xml = path.endsWith(".xml");
        const body = xml ? scenario.xml ?? buildGoogleMerchantFeed(facts) : scenario.csv ?? buildMetaCatalogFeed(facts);
        return res.writeHead(200, { "content-type": xml ? "application/xml" : "text/csv" }).end(body);
      }
      return res.writeHead(404).end();
    });
    try {
      const result = await runVerifier(origin);
      assert.equal(result.status === 0, scenario.pass, result.stdout + result.stderr);
      if (scenario.mismatch) assert.match(result.stdout, /JSON-LD sku DIFFERENT does not match visible SKU A&B/);
      else assert.match(result.stdout, scenario.pass ? /PASS Feeds/ : /FAIL Feeds/);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
}
