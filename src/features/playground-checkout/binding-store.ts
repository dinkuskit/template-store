import { COMMERCE_PLUGIN_ID } from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";

import type {
  PlaygroundCheckoutBindingRecord,
  PlaygroundCheckoutBindingStore,
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

