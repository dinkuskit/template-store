import { describe, expect, it } from "vitest";
import { createCloudflareEmailDeliver } from "@emdash-cms/cloudflare/plugins/cloudflare-email";

import { CLOUDFLARE_EMAIL_PLUGIN_ID, createPlugin, guardedDeliver, isCartEmail, MARKETING_BLOCKED } from "../../src/features/store-email/cloudflare-email.js";
import { storeCloudflareEmail, storeEmailFrom } from "../../src/features/store-email/sender.mjs";

// store-email-sender-20261122: Cloudflare sends the store's transactional email from its own address and refuses the
// abandoned cart email, the only email that carries a cart link's stop link.
const link = "https://shop.example.test/cart/c/cap-1?key=abc123";
const sent: unknown[] = [];
const binding = { async send(message: unknown) { sent.push(message); return { messageId: "m-" + sent.length }; } };
const ctx = { log: { info() {} } } as never;
const deliver = guardedDeliver(createCloudflareEmailDeliver({ from: "orders@shop.example.test" }, async () => ({ EMAIL: binding })));
const email = (text: string, html?: string) => ({ message: { to: "pat@example.test", subject: "Hello", text, ...(html ? { html } : {}) }, source: "dinkus-email" });

describe("the store's Cloudflare sender", () => {
  it("delivers order, shipping, review and sign-in emails from the store's own address", async () => {
    sent.length = 0;
    for (const text of [
      "Order #1042 confirmed. View your order: https://shop.example.test/track-order",
      "Your order has shipped. USPS 9400 1000 0000 0000 0000 00",
      "How was your Camp mug? https://shop.example.test/review?key=k1",
      // The cart link without a stop is not the cart email's stop link.
      `Your cart: ${link}`,
    ]) await deliver(email(text) as never, ctx);
    expect(sent).toHaveLength(4);
    expect(sent[0]).toMatchObject({ from: { email: "orders@shop.example.test" }, to: "pat@example.test", subject: "Hello" });
  });

  it("refuses the abandoned cart email, in text or HTML, with MARKETING_BLOCKED and sends nothing", async () => {
    sent.length = 0;
    for (const message of [
      email(`Your cart is saved: ${link}\n\nTo stop cart emails: ${link}&stop=1\n`),
      email("Your cart is saved.", `<a href="${link}&amp;stop=1">Stop cart emails</a>`),
      email("plain copy", `<a href='${link}&stop=1'>Stop</a>`),
    ]) await expect(deliver(message as never, ctx)).rejects.toThrow(/^MARKETING_BLOCKED: /);
    expect(sent).toHaveLength(0);
    expect(MARKETING_BLOCKED.startsWith("MARKETING_BLOCKED: ")).toBe(true);
  });

  it("knows the stop link only on a cart link, with stop=1 as its own query value", () => {
    expect(isCartEmail({ text: `${link}&stop=1` })).toBe(true);
    expect(isCartEmail({ text: "https://shop.example.test/cart/c/cap-1?stop=1" })).toBe(true);
    expect(isCartEmail({ text: `${link}&stop=10` })).toBe(false);
    expect(isCartEmail({ text: "https://shop.example.test/blog?stop=1" })).toBe(false);
    expect(isCartEmail({ text: "https://shop.example.test/cart?stop=1" })).toBe(false);
    expect(isCartEmail({ text: `${link}&nonstop=1` })).toBe(false);
  });

  it("is EmDash's exclusive email provider under Cloudflare's own id, so Settings > Email shows cloudflare-email", () => {
    const plugin = createPlugin({ from: "orders@shop.example.test" });
    expect(plugin.id).toBe(CLOUDFLARE_EMAIL_PLUGIN_ID);
    expect(plugin.capabilities).toEqual(["hooks.email-transport:register"]);
    expect(plugin.hooks?.["email:deliver"]).toMatchObject({ exclusive: true });
    expect(storeCloudflareEmail("orders@shop.example.test")).toMatchObject({ id: "cloudflare-email", format: "native", options: { from: "orders@shop.example.test" } });
  });

  it("sends from orders@ the store's host unless DINKUS_EMAIL_FROM names another address", () => {
    expect(storeEmailFrom({}, "https://shop.example.test")).toBe("orders@shop.example.test");
    expect(storeEmailFrom({ DINKUS_EMAIL_FROM: "hello@mail.example.test" }, "https://shop.example.test")).toBe("hello@mail.example.test");
    expect(() => storeEmailFrom({ DINKUS_EMAIL_FROM: "Shop <shop@example.test>" }, "https://shop.example.test")).toThrow(/DINKUS_EMAIL_FROM/);
    expect(() => storeEmailFrom({}, undefined)).toThrow(/DINKUS_EMAIL_FROM/);
  });
});
