export type PlaygroundCheckoutBindingRecord = {
  recordKind: "playground-checkout-binding";
  attemptId: string;
  sessionId: string;
  expiresAt: number;
};

export type PlaygroundCheckoutBindingStore = {
  get(attemptId: string): Promise<PlaygroundCheckoutBindingRecord | null>;
  put(attemptId: string, value: PlaygroundCheckoutBindingRecord): Promise<void>;
};

export function playgroundNow(env: Record<string, unknown> = (globalThis as {
  __dinkusPlaygroundEnv?: Record<string, unknown>;
}).__dinkusPlaygroundEnv ?? process.env): number {
  const fallback = process.env;
  const override = env.DINKUS_LOCAL_PROOF === "1" &&
      typeof (env.DINKUS_LOCAL_PROOF_NOW ?? fallback.DINKUS_LOCAL_PROOF_NOW) === "string"
    ? Number(env.DINKUS_LOCAL_PROOF_NOW ?? fallback.DINKUS_LOCAL_PROOF_NOW)
    : NaN;
  return Number.isFinite(override) ? override : Date.now();
}

export async function playgroundAttemptBelongsToVisitor(
  attemptId: string,
  sessionId: string,
  bindings?: PlaygroundCheckoutBindingStore,
  env?: Record<string, unknown>,
): Promise<boolean> {
  if (!bindings || !sessionId) return false;
  const binding = await bindings.get(attemptId);
  return Boolean(binding && binding.expiresAt > playgroundNow(env) && binding.sessionId === sessionId);
}
