// The store's Cloudflare sender in EmDash's own runtime and email pipeline, on Node's built-in SQLite
// (store-email-sender-20261122). Cloudflare's `send_email` binding is the one thing stood in: `cloudflare:workers`
// answers an env whose EMAIL binding records each message. EmDash picks `cloudflare-email` on its own, a plugin's
// order email goes out through Cloudflare's real deliver code, and the abandoned cart email is refused with
// MARKETING_BLOCKED, which reaches the plugin's send as an error.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sent = [];
globalThis.__storeEmailEnv = { EMAIL: { async send(message) { sent.push(message); return { messageId: "m-" + sent.length }; } } };
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
const { EmDashRuntime } = await import("emdash/internal/plugin-test-runtime");
const { createDialect } = await import("emdash/db/sqlite");
const { createPlugin } = await import("../../src/features/store-email/cloudflare-email.ts");

test("EmDash picks the store's Cloudflare sender, sends order email through it and refuses the cart email", async () => {
  const dir = mkdtempSync(join(tmpdir(), "store-email-"));
  const url = `file:${join(dir, "store.db")}`;
  try {
    const runtime = await EmDashRuntime.create({
      config: { database: { entrypoint: `store-email-${crypto.randomUUID()}`, type: "sqlite", config: { url } } },
      plugins: [createPlugin({ from: "orders@shop.example.test" })],
      createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
    });
    assert.equal(runtime.email.isAvailable(), true, "a sender is picked with nothing set up");
    const picked = runtime.email.pipeline.getExclusiveSelection("email:deliver");
    assert.equal(picked, "cloudflare-email", "EmDash picks it on its own; SMTP waits in Settings > Email");
    const message = (text, html) => ({ to: "pat@example.test", subject: "From the store", text, ...(html ? { html } : {}) });

    await runtime.email.send(message("Order #1042 confirmed. View your order: https://shop.example.test/track-order"), "dinkus-email");
    await runtime.email.send(message("Your order has shipped: USPS 9400 1000 0000 0000 0000 00"), "dinkus-email");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].from, { email: "orders@shop.example.test" });

    const cartLink = "https://shop.example.test/cart/c/cap-1?key=abc123";
    await assert.rejects(runtime.email.send(message(`Your cart is saved: ${cartLink}\n\nTo stop cart emails: ${cartLink}&stop=1`), "dinkus-email"),
      error => error.message.startsWith("MARKETING_BLOCKED: "));
    await assert.rejects(runtime.email.send(message("Your cart is saved.", `<a href="${cartLink}&amp;stop=1">Stop cart emails</a>`), "dinkus-email"),
      /^Error: MARKETING_BLOCKED: /);
    assert.equal(sent.length, 2, "the cart email never reached Cloudflare");
    console.log("store email pipeline proof", JSON.stringify({ picked, delivered: sent.map(m => ({ from: m.from.email, to: m.to, text: m.text })), cartEmails: "refused with MARKETING_BLOCKED" }));
    try { await runtime.db.destroy(); } catch {}
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
