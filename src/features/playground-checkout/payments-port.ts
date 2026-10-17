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
import { COMMERCE_PLUGIN_ID } from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";

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
const PLAYGROUND_BINDINGS_COLLECTION = "playground_checkout_bindings";

/** Per-request visitor context, set by the store middleware around checkout routes. */
type BindingRecord = { recordKind: "playground-checkout-binding"; attemptId: string; sessionId: string; expiresAt: number };
export type PlaygroundCheckoutBindingStore = {
  get(attemptId: string): Promise<BindingRecord | null>;
  put(attemptId: string, value: BindingRecord): Promise<void>;
};
type VisitorContext = { clientIp: string; sessionId: string; bindings?: PlaygroundCheckoutBindingStore };
const visitor = new AsyncLocalStorage<VisitorContext>();
/** Missing bindings fail closed; only the exact Payments expiry authorizes lookup. */
export function createPlaygroundAttemptId(): string {
  return crypto.randomUUID();
}

export function playgroundCheckoutBindingStore(db: ConstructorParameters<typeof PluginStorageRepository>[0]): PlaygroundCheckoutBindingStore {
  const repository = new PluginStorageRepository<BindingRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    PLAYGROUND_BINDINGS_COLLECTION,
    [],
  );
  return {
    async get(attemptId) {
      const value = await repository.get(attemptId);
      return value && value.recordKind === "playground-checkout-binding" ? value : null;
    },
    async put(attemptId, value) {
      await repository.put(attemptId, value);
    },
  };
}

export function withCheckoutVisitor<T>(
  clientIp: string,
  sessionId: string,
  run: () => T,
  bindings?: PlaygroundCheckoutBindingStore,
): T {
  return visitor.run({ clientIp, sessionId, bindings }, run);
}

export async function playgroundAttemptBelongsToVisitor(
  attemptId: string,
  sessionId: string,
  bindings?: PlaygroundCheckoutBindingStore,
): Promise<boolean> {
  if (!bindings || !sessionId) return false;
  const binding = await bindings.get(attemptId);
  return Boolean(binding && binding.expiresAt > Date.now() && binding.sessionId === sessionId);
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
    const currentVisitor = visitor.getStore();
    if (!currentVisitor?.sessionId) throw new Error("Visitor session unavailable");
    const clientIp = currentVisitor.clientIp;
    const attemptId = readAttemptId(init.body);
    if (!attemptId) throw new Error("Checkout attempt unavailable");
    const bindingStore = currentVisitor.bindings;
    if (!bindingStore) throw new Error("Visitor binding store unavailable");
    const binding = await bindingStore.get(attemptId);
    if (binding && binding.expiresAt <= Date.now()) {
      throw new Error("Checkout attempt expired");
    } else if (binding && binding.sessionId !== currentVisitor.sessionId) {
      throw new Error("Checkout visitor mismatch");
    }
    if (target.pathname === "/v1/checkout/lookup" && !binding) {
      throw new Error("Checkout attempt is not bound to this visitor");
    }
    // Payments requires the visitor IP to create a session (per-IP limit); a
    // lookup forwards it when known.
    if (!clientIp && target.pathname === "/v1/checkout/session") throw new Error("Visitor IP unavailable");
    const headers = new Headers(init.headers);
    if (clientIp) headers.set(PAYMENTS_CLIENT_IP_HEADER, clientIp);
    const response = await (deps.fetchImpl ?? fetch)(target.href, { ...init, headers });
    if (target.pathname === "/v1/checkout/session" && response.ok) {
      const result = await response.clone().json() as { attemptId?: unknown; session?: { expiresAt?: unknown } };
      if (typeof result.attemptId !== "string" || result.attemptId !== attemptId) {
        throw new Error("Payments attempt identity mismatch");
      }
      const expiresAt = typeof result.session?.expiresAt === "number"
        ? result.session.expiresAt * 1000
        : null;
      if (expiresAt === null) throw new Error("Payments expiry unavailable");
      await bindingStore.put(attemptId, {
        recordKind: "playground-checkout-binding",
        attemptId,
        sessionId: currentVisitor.sessionId,
        expiresAt,
      });
    }
    return response;
  };
}

function readAttemptId(body: BodyInit | null | undefined): string | null {
  if (typeof body !== "string") return null;
  try {
    const value = JSON.parse(body) as { attemptId?: unknown };
    return typeof value.attemptId === "string" && value.attemptId.length > 0 ? value.attemptId : null;
  } catch {
    return null;
  }
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
    createAttemptId: () => createPlaygroundAttemptId(),
    resolvePayments: async (bindingRef: string) =>
      bindingRef === PAYMENTS_PLAYGROUND_BINDING_REF ? resolvePlaygroundPayments(env) : null,
    pricing: {
      paymentPricingSchema: CHECKOUT_PRICING_SCHEMA,
      resolveShippingConfiguration: async () =>
        structuredClone(PLAYGROUND_FLAT_RATE_SHIPPING) as TrustedShippingConfiguration,
    },
  };
}
