/**
 * The playground's email provider: EmDash's exclusive `email:deliver` hook, so an installed plugin's
 * `ctx.email.send` works in a visitor's store. It sends through the playground Worker's `EMAIL` binding and
 * captures the message in the local proof modes.
 * Real stores pick their own email provider; the playground has no other, so EmDash selects this one.
 */
import { definePlugin } from "emdash";

import { deliverPlaygroundEmail } from "./mail-delivery.js";

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
          await deliverPlaygroundEmail({ to: message.to, subject: message.subject, text: message.text });
        },
      },
    },
  });
}

export default createPlugin;
