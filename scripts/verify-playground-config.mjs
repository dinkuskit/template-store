import { readFileSync } from "node:fs";

const config = readFileSync("wrangler.playground.jsonc", "utf8");
const forbidden = /\b(?:secret|payments?|coupons?|stripe)\b/i;

if (forbidden.test(config)) {
  throw new Error(
    "Playground Wrangler config must not contain secrets, payments, coupons, or Stripe bindings.",
  );
}

for (const required of [
  '"account_id": "cddb32366789cab1bdf4c25584dc1920"',
  '"workers_dev": false',
  '"preview_urls": false',
  '"pattern": "playground.dinkuskit.com"',
  '"custom_domain": true',
  '"previews_enabled": true',
  '"name": "PLAYGROUND_CREATION_LIMITER"',
  '"name": "PLAYGROUND_GLOBAL_LIMITER"',
]) {
  if (!config.includes(required)) {
    throw new Error(`Playground Wrangler config is missing ${required}.`);
  }
}

if (config.includes("workers.dev")) {
  throw new Error("Playground URLs must never be configured as workers.dev URLs.");
}

// demo.dinkuskit.com belongs to the live demo Worker; the playground must not claim it.
if (/["/.]demo\.dinkuskit\.com/.test(config)) {
  throw new Error("Playground Wrangler config must not route demo.dinkuskit.com.");
}

console.log("Playground Wrangler config passed binding and domain policy checks.");
