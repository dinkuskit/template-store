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

const BINDINGS_LOCAL = "__playgroundCheckoutBindings";

/** The request's published binding store, only on a playground request. Portable: no storage imports. */
export function playgroundCheckoutBindingsFromLocals(locals: unknown): PlaygroundCheckoutBindingStore | undefined {
  if (!locals || typeof locals !== "object") return undefined;
  const scoped = locals as Record<string, unknown>;
  if (!scoped.__playgroundDb) return undefined;
  const store = scoped[BINDINGS_LOCAL] as Partial<PlaygroundCheckoutBindingStore> | undefined;
  return store && typeof store.get === "function" && typeof store.put === "function"
    ? store as PlaygroundCheckoutBindingStore
    : undefined;
}

export function publishPlaygroundCheckoutBindings(locals: unknown, store: PlaygroundCheckoutBindingStore): void {
  (locals as Record<string, unknown>)[BINDINGS_LOCAL] = store;
}

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
