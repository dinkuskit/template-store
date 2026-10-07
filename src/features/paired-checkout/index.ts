import {
  CHECKOUT_PRICING_SCHEMA,
  createInstalledCheckoutHandlers,
  type InstalledCheckoutServices,
  type TrustedShippingConfiguration,
} from "@dinkuskit/commerce/features/checkout";
import {
  createTrustedTestCheckoutHostAssembly,
  type TrustedTestCheckoutHostConfig,
} from "../test-checkout-host/index.js";

export { CHECKOUT_PRICING_SCHEMA };
export const REVIEWED_COMMERCE_SOURCE =
  "70419ae55c4f73354e3f0eda08b09bbc85368000";
export const REVIEWED_PAYMENTS_SOURCE =
  "37842220fddb10dc5294af084110cd33804715be";

export interface PairedCheckoutServerConfig extends TrustedTestCheckoutHostConfig {
  readonly pricingSchema: typeof CHECKOUT_PRICING_SCHEMA;
  readonly commerceSource: typeof REVIEWED_COMMERCE_SOURCE;
  readonly paymentsSource: typeof REVIEWED_PAYMENTS_SOURCE;
  readonly resolveShippingConfiguration: () => Promise<TrustedShippingConfiguration | null>;
}

/**
 * Explicit source-level TEST composition. Call these handlers only from an
 * admitted runtime-owned Commerce route/hook with its original PluginContext.
 * Constructing this assembly neither installs nor attests a Registry plugin.
 * Commerce binds coupon/checkout storage from that context; the host supplies
 * only trusted transport and shipping configuration, never a second writer.
 */
export function createPairedCheckoutConsumer(input: PairedCheckoutServerConfig) {
  if (input.pricingSchema !== CHECKOUT_PRICING_SCHEMA ||
      input.commerceSource !== REVIEWED_COMMERCE_SOURCE ||
      input.paymentsSource !== REVIEWED_PAYMENTS_SOURCE ||
      typeof input.resolveShippingConfiguration !== "function") {
    throw new Error("Unsupported matched TEST checkout configuration");
  }
  const config = Object.freeze({ ...input });
  const assembly = createTrustedTestCheckoutHostAssembly(config);
  const services: InstalledCheckoutServices = Object.freeze({
    host: Object.freeze({
      ...assembly.checkoutHost,
      pricing: Object.freeze({
        paymentPricingSchema: CHECKOUT_PRICING_SCHEMA,
        resolveShippingConfiguration: config.resolveShippingConfiguration,
      }),
    }),
    wakes: assembly.wakePort,
  });
  // The canonical adapter declares the same explicit pricing schema. Canonical
  // Commerce admission checks it before creation and recovery provider calls.
  const handlers = createInstalledCheckoutHandlers(async () => services);
  return Object.freeze({ config, services, ...handlers });
}
