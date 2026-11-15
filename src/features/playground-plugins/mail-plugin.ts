/**
 * The playground's email provider: EmDash's exclusive `email:deliver` hook, so an installed plugin's
 * `ctx.email.send` works in a visitor's store. Commerce's Registry build emails a shopper's 6-digit sign-in
 * code through it (template-one-build-registry-20261031); it sends through the playground Worker's `EMAIL`
 * binding exactly as the playground's sign-in always did, and captures the message in the local proof modes.
 * Real stores pick their own email provider; the playground has no other, so EmDash selects this one.
 */
import { definePlugin } from "emdash";

import { deliverPlaygroundShopperEmail } from "../shopper-account/playground-runtime.js";

export const PLAYGROUND_MAIL_PLUGIN_ID = "dinkus-playground-mail";

export function createPlugin() {
  return definePlugin({
    id: PLAYGROUND_MAIL_PLUGIN_ID,
    version: "1.0.0",
    capabilities: ["email:provide"],
    hooks: {
      "email:deliver": {
        exclusive: true,
        handler: async ({ message }) => {
          await deliverPlaygroundShopperEmail({ to: message.to, subject: message.subject, text: message.text });
        },
      },
    },
  });
}

export default createPlugin;
