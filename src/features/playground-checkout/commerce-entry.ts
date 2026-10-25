/**
 * Playground-only native Commerce entrypoint: Commerce's own createPlugin with
 * the playground checkout and shopper-account host options. Commerce itself is
 * unchanged; checkout stays inert until DINKUS_CHECKOUT_ENABLED and the
 * Payments env are set, while shopper-account routes resolve the active
 * deployment/preview origin dynamically per request.
 */
import {
  createPlugin as createCommercePlugin,
  createShopperAccountOrdersRoute,
  createShopperAccountProfileRoute,
  createShopperSignInStartRoute,
  createShopperSignInVerifyRoute,
  createShopperSignOutRoute,
  listOrdersForEmail,
  ORDERS_COLLECTION,
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
  type CommercePluginOptions,
  type OrdersCollection,
} from "@dinkuskit/commerce";
import { playgroundShopperAccountHostOptions } from "../shopper-account/playground-runtime.js";

import { playgroundCheckoutHostOptions } from "./payments-port.js";

const nativeOrdersForEmail = (storage: Record<string, unknown>, emailKey: string) =>
  listOrdersForEmail(storage[ORDERS_COLLECTION] as OrdersCollection, emailKey);

export function createPlugin(options: CommercePluginOptions = {}) {
  const checkout = playgroundCheckoutHostOptions();
  const customers = playgroundShopperAccountHostOptions(process.env, options.siteUrl);
  const plugin = createCommercePlugin({ ...options, checkout });
  const profileRoute = createShopperAccountProfileRoute(customers, nativeOrdersForEmail);
  return {
    ...plugin,
    routes: {
      ...plugin.routes,
      [SHOPPER_SIGN_IN_START_ROUTE]: createShopperSignInStartRoute(customers),
      [SHOPPER_SIGN_IN_VERIFY_ROUTE]: createShopperSignInVerifyRoute(
        customers,
        nativeOrdersForEmail,
      ),
      [SHOPPER_SIGN_OUT_ROUTE]: createShopperSignOutRoute(customers),
      [SHOPPER_ACCOUNT_ORDERS_ROUTE]: createShopperAccountOrdersRoute(
        customers,
        nativeOrdersForEmail,
      ),
      [SHOPPER_ACCOUNT_PROFILE_ROUTE]: {
        ...profileRoute,
        // EmDash's declared body:"json" wire parser rejects bodyless GET requests
        // before the dual-method (GET/POST) route handler runs; omitting request.body
        // lets EmDash parse JSON on POST and query params on GET while middleware
        // enforces the byte cap on POST.
        request: undefined,
      },
    },
  };
}

export default createPlugin;
