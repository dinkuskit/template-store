/**
 * The store's Cloudflare sender (store-email-sender-20261122): EmDash's own Cloudflare Email Sending provider, under
 * its own id `cloudflare-email`, with one guard in front of it. Cloudflare's terms allow transactional email only, so
 * while this sender is the one picked in Settings > Email it refuses the abandoned cart email, which is marketing,
 * whichever plugin sends it. It knows that email by the cart link's stop link (`/cart/c/<id>?key=<secret>&stop=1`),
 * which only the cart email carries. Order and shipping confirmations, review emails and sign-in links go through.
 *
 * The refusal is an error whose message starts `MARKETING_BLOCKED: `, so the sending plugin's `ctx.email.send` fails
 * and Store emails records "Not sent: cart emails need an SMTP sender" instead of "Sent". With SMTP picked, this
 * provider is not called at all and cart emails go out. When EmDash labels each email transactional or marketing,
 * the guard moves to that label.
 */
import { definePlugin } from "emdash";
import { createCloudflareEmailDeliver, type CloudflareEmailConfig } from "@emdash-cms/cloudflare/plugins/cloudflare-email";

export const CLOUDFLARE_EMAIL_PLUGIN_ID = "cloudflare-email";
export const MARKETING_BLOCKED =
  "MARKETING_BLOCKED: Cart emails are marketing, so they need an SMTP sender. Cloudflare's sender doesn't allow marketing email; pick SMTP in Settings > Email.";

/** A link to /cart/c/... with stop=1 among its query, in text or in an HTML href (`&` or `&amp;`). */
const CART_STOP_LINK = /\/cart\/c\/[^\s"'<>]*?[?&](?:amp;)?stop=1(?![0-9A-Za-z])/;

export function isCartEmail(message: { text?: unknown; html?: unknown }): boolean {
  return [message.text, message.html].some(part => typeof part === "string" && CART_STOP_LINK.test(part));
}

type Deliver = ReturnType<typeof createCloudflareEmailDeliver>;

/** The guarded `email:deliver` handler; `deliver` is Cloudflare's own. */
export function guardedDeliver(deliver: Deliver): Deliver {
  return async (event, ctx) => {
    if (isCartEmail(event.message)) throw new Error(MARKETING_BLOCKED);
    await deliver(event, ctx);
  };
}

/** Called by EmDash's generated plugin module with the descriptor's options. */
export function createPlugin(config: CloudflareEmailConfig) {
  return definePlugin({
    id: CLOUDFLARE_EMAIL_PLUGIN_ID,
    version: "1.0.0",
    capabilities: ["hooks.email-transport:register"],
    hooks: { "email:deliver": { exclusive: true, handler: guardedDeliver(createCloudflareEmailDeliver(config)) } },
  });
}

export default createPlugin;
