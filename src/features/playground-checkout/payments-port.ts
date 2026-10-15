/**
 * Host-side Payments port for the playground's native Commerce plugin.
 *
 * Commerce's own trusted TEST payment port does the request shaping and
 * outcome validation; this module only supplies its credential (a store pass
 * minted from PAYMENTS_STORE_KEY) and a scoped fetch that adds the playground
 * headers. Everything resolves at request time from Worker env, so a missing
 * flag or value leaves Commerce without a payment port (checkout unavailable).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  CHECKOUT_PRICING_SCHEMA,
  createTrustedTestPaymentPort,
  type CheckoutPaymentPort,
  type GuestCheckoutHostOptions,
  type TrustedShippingConfiguration,
} from "@dinkuskit/commerce/features/checkout";

import { PLAYGROUND_FLAT_RATE_SHIPPING } from "../playground/flat-rate-shipping.js";
import {
  getStorePass,
  isCheckoutEnabled,
  readStripeAccount,
  PAYMENTS_CLIENT_IP_HEADER,
  PAYMENTS_PLAYGROUND_SITE,
  readPaymentsConfig,
} from "./index.js";

export const PAYMENTS_PLAYGROUND_BINDING_REF = "playground";
export { PAYMENTS_STRIPE_ACCOUNT_ENV, playgroundCheckoutConfigured } from "./index.js";
/** Stands in for the store origin Payments takes from the pass; the port never sends it. */
const PLAYGROUND_COMMERCE_ORIGIN = "https://playground.dinkuskit.com";

type EnvLike = Record<string, unknown>;

/** Per-request visitor context, set by the store middleware around checkout routes. */
const visitor = new AsyncLocalStorage<{ clientIp: string }>();
export function withCheckoutVisitor<T>(clientIp: string, run: () => T): T {
  return visitor.run({ clientIp }, run);
}

const stripeAccount = readStripeAccount;

/**
 * Payments (#41) serves the playground tenant on session, lookup and receipt
 * only; its binding is fixed (binding ref "playground", Stripe test mode). So
 * Commerce's binding pre-check is answered here with that fixed binding
 * instead of calling a route the playground pass cannot reach.
 */
export function playgroundPaymentsFetch(
  env: EnvLike,
  deps: { fetchImpl?: typeof fetch; passFetchImpl?: typeof fetch } = {},
) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const config = readPaymentsConfig(env);
    const account = stripeAccount(env);
    if (!isCheckoutEnabled(env) || !config || !account) throw new Error("Playground checkout unavailable");
    const target = new URL(url);
    if (target.origin !== config.baseUrl) throw new Error("Unexpected Payments origin");
    if (target.pathname === "/v1/checkout-binding" || target.pathname === "/v1/existing-binding") {
      if (target.searchParams.get("bindingRef") !== PAYMENTS_PLAYGROUND_BINDING_REF) throw new Error("Unknown binding");
      return Response.json({ bindingRef: PAYMENTS_PLAYGROUND_BINDING_REF, providerId: "stripe", stripeAccountId: account, mode: "test", ready: true });
    }
    if (target.pathname !== "/v1/checkout/session" && target.pathname !== "/v1/checkout/lookup") {
      throw new Error("Unexpected Payments route");
    }
    // Payments requires the visitor IP to create a session (per-IP limit); a
    // lookup forwards it when known.
    const clientIp = visitor.getStore()?.clientIp;
    if (!clientIp && target.pathname === "/v1/checkout/session") throw new Error("Visitor IP unavailable");
    const headers = new Headers(init.headers);
    if (clientIp) headers.set(PAYMENTS_CLIENT_IP_HEADER, clientIp);
    return (deps.fetchImpl ?? fetch)(target.href, { ...init, headers });
  };
}

/** Commerce's port for binding ref "playground", or null (fail closed) when not configured. */
export function resolvePlaygroundPayments(
  env: EnvLike = process.env,
  deps: { fetchImpl?: typeof fetch; passFetchImpl?: typeof fetch } = {},
): CheckoutPaymentPort | null {
  const config = readPaymentsConfig(env);
  const account = stripeAccount(env);
  if (!isCheckoutEnabled(env) || !config || !account) return null;
  return createTrustedTestPaymentPort({
    paymentsOrigin: config.baseUrl,
    siteId: PAYMENTS_PLAYGROUND_SITE,
    commerceOrigin: PLAYGROUND_COMMERCE_ORIGIN,
    bindingRef: PAYMENTS_PLAYGROUND_BINDING_REF,
    providerId: "stripe",
    stripeAccountId: account,
    pricingSchema: CHECKOUT_PRICING_SCHEMA,
    credentialResolver: async () => {
      const current = readPaymentsConfig(env);
      const pass = current ? await getStorePass(current, { fetchImpl: deps.passFetchImpl }) : null;
      if (!pass) throw new Error("Payments credential unavailable");
      return pass;
    },
    fetch: playgroundPaymentsFetch(env, deps),
  });
}

/** Build-time checkout options for the playground's native Commerce plugin. */
export function playgroundCheckoutHostOptions(env: EnvLike = process.env): GuestCheckoutHostOptions {
  return {
    paymentBindingRef: PAYMENTS_PLAYGROUND_BINDING_REF,
    resolvePayments: async (bindingRef: string) =>
      bindingRef === PAYMENTS_PLAYGROUND_BINDING_REF ? resolvePlaygroundPayments(env) : null,
    pricing: {
      paymentPricingSchema: CHECKOUT_PRICING_SCHEMA,
      resolveShippingConfiguration: async () =>
        structuredClone(PLAYGROUND_FLAT_RATE_SHIPPING) as TrustedShippingConfiguration,
    },
  };
}
