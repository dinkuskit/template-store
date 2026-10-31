/**
 * The playground's checkout guard for the visitor's Commerce.
 *
 * Every visitor's store runs Commerce's Registry build (template-one-build-registry-20261031); its calls to the
 * real Payments service carry the pass the playground's own checkout key gets (see the pretend DinkusKit,
 * dinkuskit-stand-in.ts) and pass through `playgroundPaymentsFetch` here: the playground tenant serves session
 * and lookup only, Commerce's binding check is answered with the fixed playground binding, the visitor's IP is
 * forwarded, and each attempt is bound to the visitor session that started it. Everything resolves at request
 * time from Worker env, so a missing flag or value leaves checkout unavailable.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  playgroundNow,
  type PlaygroundCheckoutBindingStore,
} from "./binding-auth.js";
export { playgroundAttemptBelongsToVisitor } from "./binding-auth.js";
export { playgroundCheckoutBindingStore } from "./binding-store.js";
export type { PlaygroundCheckoutBindingStore } from "./binding-auth.js";
import {
  isCheckoutEnabled,
  readStripeAccount,
  PAYMENTS_CLIENT_IP_HEADER,
  readPaymentsConfig,
} from "./index.js";

export const PAYMENTS_PLAYGROUND_BINDING_REF = "playground";
export { PAYMENTS_STRIPE_ACCOUNT_ENV, playgroundCheckoutConfigured } from "./index.js";
const MAX_PAYMENTS_RESPONSE_BYTES = 128 * 1024;

type EnvLike = Record<string, unknown>;
/** Per-request visitor context, set by the store middleware around checkout routes. */
type VisitorContext = { clientIp: string; sessionId: string; bindings?: PlaygroundCheckoutBindingStore };
const visitor = new AsyncLocalStorage<VisitorContext>();
export function withCheckoutVisitor<T>(
  clientIp: string,
  sessionId: string,
  run: () => T,
  bindings?: PlaygroundCheckoutBindingStore,
): T {
  return visitor.run({ clientIp, sessionId, bindings }, run);
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
    if (binding && binding.expiresAt <= playgroundNow(env)) {
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
    const localTarget = env.DINKUS_LOCAL_PROOF === "1" && typeof env.PAYMENTS_LOCAL_HTTP_URL === "string"
      ? new URL(target.pathname + target.search, env.PAYMENTS_LOCAL_HTTP_URL)
      : target;
    const response = await (deps.fetchImpl ?? fetch)(localTarget.href, { ...init, headers, redirect: "manual" });
    if (target.pathname === "/v1/checkout/session" && response.ok) {
      // Consume the one response stream with a hard bound, then hand Commerce a
      // rebuilt Response. No clone/tee: an oversized body is rejected at once
      // instead of waiting on an unread sibling branch.
      const bytes = await readBoundedPaymentsResponse(response);
      if (bytes === null) throw new Error("Payments response too large");
      const responseBody = new TextDecoder().decode(bytes);
      let result: { attemptId?: unknown; session?: { expiresAt?: unknown } };
      try {
        result = JSON.parse(responseBody) as { attemptId?: unknown; session?: { expiresAt?: unknown } };
      } catch {
        throw new Error("Payments response invalid");
      }
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
      const rebuiltHeaders = new Headers(response.headers);
      rebuiltHeaders.delete("content-length");
      rebuiltHeaders.delete("content-encoding");
      return new Response(bytes.buffer as ArrayBuffer, { status: response.status, statusText: response.statusText, headers: rebuiltHeaders });
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

/**
 * Reads the session response body once, bounded. On overflow the stream is
 * cancelled without awaiting (cancellation must never delay the rejection).
 */
export async function readBoundedPaymentsResponse(response: Response): Promise<Uint8Array | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_PAYMENTS_RESPONSE_BYTES)) {
    response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PAYMENTS_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
