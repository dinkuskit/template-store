import { AsyncLocalStorage } from "node:async_hooks";

import { playgroundNow } from "../playground-checkout/binding-auth.js";

/**
 * How the playground sends email: through the playground Worker's Cloudflare `send_email` binding `EMAIL`
 * (structured `{ to, from, subject, text }` payloads), and, in the local proof and demo modes, also into an
 * in-memory capture the proof pages read. Each request runs inside its own env so concurrent visitors never
 * share bindings.
 */
type EnvLike = Record<string, unknown>;

export const PLAYGROUND_EMAIL_BINDING = "EMAIL";
export const PLAYGROUND_DEFAULT_FROM_EMAIL = "accounts@dinkuskit.com";

type PlaygroundRequestContext = Readonly<{ requestOrigin: string; env: EnvLike }>;
export type CapturedProofEmail = Readonly<{ to: string; subject: string; text: string; code: string | null; sentAt: string }>;
export type PlaygroundEmailMessage = Readonly<{ to: string; subject: string; text: string }>;

export interface CloudflareEmailBinding {
  send(message: {
    to: string | string[];
    from: { email: string; name?: string } | string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }>;
}

type GlobalMailState = {
  __dinkusPlaygroundRequestContext?: AsyncLocalStorage<PlaygroundRequestContext>;
  __dinkusCapturedProofEmails?: Map<string, CapturedProofEmail>;
};
const globalState = globalThis as unknown as GlobalMailState;
const requestContext = globalState.__dinkusPlaygroundRequestContext ??
  (globalState.__dinkusPlaygroundRequestContext = new AsyncLocalStorage<PlaygroundRequestContext>());
const capturedProofEmails = globalState.__dinkusCapturedProofEmails ??
  (globalState.__dinkusCapturedProofEmails = new Map<string, CapturedProofEmail>());

/** Runs one playground request with its own Worker env. */
export function withPlaygroundRequest<T>(requestOrigin: string, env: EnvLike, run: () => T): T {
  return requestContext.run({ requestOrigin, env }, run);
}

function resolveActiveEnv(env: EnvLike = process.env): EnvLike {
  return requestContext.getStore()?.env ?? (globalThis as { __dinkusPlaygroundEnv?: EnvLike }).__dinkusPlaygroundEnv ?? env;
}

export function isLocalProofOrDemoMode(env: EnvLike = process.env): boolean {
  const activeEnv = resolveActiveEnv(env);
  return activeEnv.DINKUS_LOCAL_PROOF === "1" || activeEnv.DINKUS_PROOF_MODE === "1" || activeEnv.DINKUS_STOREFRONT_PROFILE === "proof";
}

export function readCapturedProofEmail(email: string): CapturedProofEmail | null {
  return capturedProofEmails.get(email.trim().toLowerCase()) ?? null;
}

export function clearCapturedProofEmails(): void {
  capturedProofEmails.clear();
}

function isEmailBinding(candidate: unknown): candidate is CloudflareEmailBinding {
  return typeof candidate === "object" && candidate !== null && typeof (candidate as { send?: unknown }).send === "function";
}

/** Sends one email from the playground, capturing it in the local proof and demo modes. */
export async function deliverPlaygroundEmail(message: PlaygroundEmailMessage, env: EnvLike = process.env): Promise<void> {
  const activeEnv = resolveActiveEnv(env);
  const emailBinding = activeEnv[PLAYGROUND_EMAIL_BINDING];
  const outgoing = { to: message.to, from: { email: PLAYGROUND_DEFAULT_FROM_EMAIL, name: "DinkusKit Playground" }, subject: message.subject, text: message.text };
  if (isLocalProofOrDemoMode(activeEnv)) {
    const recipient = message.to.trim().toLowerCase();
    capturedProofEmails.set(recipient, {
      to: recipient, subject: message.subject, text: message.text,
      code: message.text.match(/\b(\d{6})\b/u)?.[1] ?? null, sentAt: new Date(playgroundNow(activeEnv)).toISOString(),
    });
    if (isEmailBinding(emailBinding)) await emailBinding.send(outgoing);
    return;
  }
  if (!isEmailBinding(emailBinding)) throw new Error("Outbound email transport is not configured.");
  await emailBinding.send(outgoing);
}
