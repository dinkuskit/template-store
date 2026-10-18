import { COMMERCE_PLUGIN_ID } from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";

import {
  playgroundCheckoutBindingsFromLocals,
  publishPlaygroundCheckoutBindings,
  type PlaygroundCheckoutBindingRecord,
  type PlaygroundCheckoutBindingStore,
} from "./binding-auth.js";
export type { PlaygroundCheckoutBindingRecord, PlaygroundCheckoutBindingStore } from "./binding-auth.js";

const PLAYGROUND_BINDINGS_COLLECTION = "playground_checkout_bindings";

export function playgroundCheckoutBindingStore(
  db: ConstructorParameters<typeof PluginStorageRepository>[0],
): PlaygroundCheckoutBindingStore {
  const repository = new PluginStorageRepository<PlaygroundCheckoutBindingRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    PLAYGROUND_BINDINGS_COLLECTION,
    [],
  );
  return {
    async get(attemptId) {
      const value = await repository.get(attemptId);
      return value?.recordKind === "playground-checkout-binding" ? value : null;
    },
    async put(attemptId, value) {
      await repository.put(attemptId, value);
    },
  };
}

/**
 * The one persistent binding store for this request. The middleware calls this
 * before dispatching a checkout or status route, which publishes the store on
 * `locals`; the `/api/checkout/status` route reads that same store back with
 * `playgroundCheckoutBindingsFromLocals`, so start (which writes the binding)
 * and both status entrypoints (which authorize against it) share one store.
 * Non-playground requests get `undefined`, which authorizes nothing.
 */
export function playgroundCheckoutBindingsFor(locals: unknown): PlaygroundCheckoutBindingStore | undefined {
  const existing = playgroundCheckoutBindingsFromLocals(locals);
  if (existing) return existing;
  if (!locals || typeof locals !== "object") return undefined;
  const scoped = locals as { __playgroundDb?: unknown };
  if (!scoped.__playgroundDb) return undefined;
  const store = playgroundCheckoutBindingStore(scoped.__playgroundDb as ConstructorParameters<typeof PluginStorageRepository>[0]);
  publishPlaygroundCheckoutBindings(locals, store);
  return store;
}
