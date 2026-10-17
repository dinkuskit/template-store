/**
 * Playground-only native Commerce entrypoint: Commerce's own createPlugin with
 * the playground checkout host options. Commerce itself is unchanged; the
 * options stay inert until DINKUS_CHECKOUT_ENABLED and the Payments env are set.
 */
import { createPlugin as createCommercePlugin, type CommercePluginOptions } from "@dinkuskit/commerce";

import { playgroundCheckoutHostOptions } from "./payments-port.js";

export function createPlugin(options: CommercePluginOptions = {}) {
  const checkout = playgroundCheckoutHostOptions();
  return createCommercePlugin({ ...options, checkout });
}

export default createPlugin;
