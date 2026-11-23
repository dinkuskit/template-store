// The store's email sender, chosen at build time (store-email-sender-20261122). A Cloudflare store sends from its
// own address through Cloudflare Email Sending (`send_email` binding EMAIL), guarded against cart emails by
// ./cloudflare-email.ts. Any store can switch to EmDash's built-in SMTP sender in Settings > Email, which keeps its
// login encrypted under EMDASH_ENCRYPTION_KEY.
import { fileURLToPath } from "node:url";

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The sender address: DINKUS_EMAIL_FROM, else orders@ the store's own host. */
export function storeEmailFrom(env, siteUrl) {
  const from = env.DINKUS_EMAIL_FROM?.trim() || (siteUrl ? `orders@${new URL(siteUrl).hostname}` : "");
  if (!ADDRESS.test(from)) throw new Error("DINKUS_EMAIL_FROM must be one email address on a domain onboarded for Cloudflare Email Sending");
  return from;
}

/** The emdash() plugins entry for the guarded Cloudflare sender. */
export function storeCloudflareEmail(from) {
  return {
    id: "cloudflare-email",
    version: "1.0.0",
    entrypoint: fileURLToPath(new URL("./cloudflare-email.ts", import.meta.url)),
    format: "native",
    options: { from },
    capabilities: ["hooks.email-transport:register"],
  };
}
