// An existing store that already sends through SMTP keeps doing so after it updates to the template with Cloudflare's
// sender (store-email-sender-20261122). Two runtimes share one SQLite database: the first is the template before this
// change, with no Cloudflare sender, where the owner saves SMTP through EmDash's own Settings > Email route; the second
// adds the store's Cloudflare sender. The store's SMTP pick, host, user and encrypted password survive, and its order
// and cart emails both reach a local SMTP server over TLS, while Cloudflare's binding gets nothing. Switching to
// cloudflare-email then refuses the cart email, and switching back to SMTP is one save that keeps the saved login.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tls from "node:tls";

const cloudflare = [];
globalThis.__storeEmailEnv = { EMAIL: { async send(message) { cloudflare.push(message); return { messageId: "m-" + cloudflare.length }; } } };
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier.startsWith("virtual:emdash/")) return { url: "data:text/javascript,export default undefined;", shortCircuit: true };
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = globalThis.__storeEmailEnv;", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes("/node_modules/emdash/dist/") || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll("import.meta.env", "({ DEV: false, PROD: true })") };
  },
});
// EmDash reads the key when a runtime is made, as a store's Worker does from its secret.
process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${randomBytes(32).toString("base64url")}`;
const { EmDashRuntime } = await import("emdash/internal/plugin-test-runtime");
const { createDialect } = await import("emdash/db/sqlite");
const emailRoute = await import("emdash/internal/routes/api/settings/email");
const { createPlugin } = await import("../../src/features/store-email/cloudflare-email.ts");

/** A local SMTP server on implicit TLS, with a certificate made for this run and trusted by this process only. */
async function smtpServer(dir) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
  const cert = readFileSync(join(dir, "cert.pem"), "utf8");
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), cert]);
  const received = [];
  const server = tls.createServer({ key: readFileSync(join(dir, "key.pem")), cert }, socket => {
    let buffer = "", data = null, mail = { rcpt: [] };
    const say = line => socket.write(`${line}\r\n`);
    say("220 test ESMTP");
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line === ".") { received.push({ ...mail, data: data.join("\n") }); mail = { rcpt: [] }; data = null; say("250 queued"); }
          else data.push(line);
        } else if (/^EHLO /i.test(line)) say("250-test\r\n250 AUTH PLAIN");
        else if (/^AUTH PLAIN /i.test(line)) { mail.auth = Buffer.from(line.slice(11), "base64").toString().split("\0").slice(1); say("235 ok"); }
        else if (/^MAIL FROM:/i.test(line)) { mail.from = line.slice(10); say("250 ok"); }
        else if (/^RCPT TO:/i.test(line)) { mail.rcpt.push(line.slice(8)); say("250 ok"); }
        else if (/^DATA$/i.test(line)) { data = []; say("354 go"); }
        else if (/^QUIT$/i.test(line)) { say("221 bye"); socket.end(); }
        else say("502 no");
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, received, close: () => new Promise(resolve => server.close(resolve)) };
}

const admin = { id: "owner", email: "owner@example.test", role: 50 };
/** EmDash's own Settings > Email route, as the admin page calls it. */
async function settings(runtime, method, body) {
  const locals = { emdash: { db: runtime.db, hooks: runtime.hooks, email: runtime.email }, user: admin };
  const request = new Request("http://store.test/_emdash/api/settings/email", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await emailRoute[method]({ request, locals });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return json.data ?? json;
}

test("a store that already sends through SMTP keeps its sender, login and cart emails after the update", async () => {
  const dir = mkdtempSync(join(tmpdir(), "store-email-upgrade-"));
  const url = `file:${join(dir, "store.db")}`;
  const smtp = await smtpServer(dir);
  const runtimeWith = plugins => EmDashRuntime.create({
    config: { database: { entrypoint: `store-email-upgrade-${crypto.randomUUID()}`, type: "sqlite", config: { url } } },
    plugins, createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
  });
  const message = (text, html) => ({ to: "pat@example.test", subject: "From the store", text, ...(html ? { html } : {}) });
  const cartLink = "https://shop.example.test/cart/c/cap-1?key=abc123";
  const cartEmail = message(`Your cart is saved: ${cartLink}\n\nTo stop cart emails: ${cartLink}&stop=1`);
  try {
    // Before: the template without Cloudflare's sender. The owner saves SMTP in Settings > Email and it sends.
    const before = await runtimeWith([]);
    assert.equal(before.email.isAvailable(), false, "nothing is picked until the owner saves SMTP");
    await settings(before, "PUT", { provider: "smtp", smtp: { host: "127.0.0.1", port: smtp.port, secure: "tls", user: "smtp-user", pass: "smtp-key-1", fromEmail: "hello@shop.example.test" } });
    await before.email.send(message("Order #1041 confirmed."), "dinkus-email");
    assert.equal(smtp.received.length, 1);
    try { await before.db.destroy(); } catch {}

    // After: the same database under this template, which adds the store's Cloudflare sender.
    const after = await runtimeWith([createPlugin({ from: "orders@shop.example.test" })]);
    const picked = after.email.pipeline.getExclusiveSelection("email:deliver");
    assert.equal(picked, "emdash-builtin-smtp", "the owner's SMTP pick is kept, not replaced by cloudflare-email");
    const shown = await settings(after, "GET");
    assert.deepEqual(shown.providers.map(p => p.pluginId).sort(), ["cloudflare-email", "emdash-builtin-smtp"]);
    assert.equal(shown.selectedProviderId, "emdash-builtin-smtp");
    assert.deepEqual(shown.smtp, { configured: true, source: "db", host: "127.0.0.1", port: smtp.port, secure: "tls", user: "smtp-user", fromEmail: "hello@shop.example.test" });

    await after.email.send(message("Order #1042 confirmed. View your order: https://shop.example.test/track-order"), "dinkus-email");
    await after.email.send(cartEmail, "dinkus-email");
    assert.equal(smtp.received.length, 3, "order and cart emails both went out through SMTP");
    assert.deepEqual(smtp.received[2].auth, ["smtp-user", "smtp-key-1"], "the saved password still decrypts");
    const body = mail => Buffer.from(mail.data.split("\n\n").slice(1).join(""), "base64").toString();
    assert.match(body(smtp.received[2]), /To stop cart emails: https:\/\/shop\.example\.test\/cart\/c\/cap-1\?key=abc123&stop=1/);
    assert.match(smtp.received[2].data, /^From: hello@shop\.example\.test$/m, "from the sender saved before the update");
    assert.equal(cloudflare.length, 0, "Cloudflare's binding was never called");

    // Picking cloudflare-email refuses cart emails; picking SMTP again is one save and keeps the saved login.
    await settings(after, "PUT", { provider: "plugin", pluginId: "cloudflare-email" });
    await assert.rejects(after.email.send(cartEmail, "dinkus-email"), /^Error: MARKETING_BLOCKED: /);
    await after.email.send(message("Order #1043 confirmed."), "dinkus-email");
    assert.equal(cloudflare.length, 1);
    await settings(after, "PUT", { provider: "smtp" });
    await after.email.send(cartEmail, "dinkus-email");
    assert.equal(smtp.received.length, 4);
    assert.deepEqual(smtp.received[3].auth, ["smtp-user", "smtp-key-1"]);
    console.log("store email upgrade proof", JSON.stringify({
      before: { picked: "emdash-builtin-smtp", smtpDelivered: 1 },
      after: { picked, providers: shown.providers.map(p => p.pluginId), smtp: { ...shown.smtp, port: "<local>" }, smtpDelivered: 2, cloudflareCalls: 0 },
      cloudflarePicked: { cartEmail: "MARKETING_BLOCKED", orderEmail: "sent by Cloudflare" },
      smtpPickedAgain: { cartEmail: "sent by SMTP with the saved login" },
    }));
    try { await after.db.destroy(); } catch {}
  } finally {
    await smtp.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
