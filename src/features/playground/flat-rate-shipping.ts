/**
 * Flat-rate shipping for playground sandbox checkout. Matches Commerce's
 * TrustedShippingConfiguration (`mode: "flat"`, USD), so checkout never asks
 * Ship for a rate or label and the playground needs no Ship credential.
 * Written as the `shipping` member of the playground checkout settings.
 */
export const PLAYGROUND_FLAT_RATE_SHIPPING = Object.freeze({
  configurationId: "playground-flat-rate",
  revision: 1,
  mode: "flat" as const,
  amount: Object.freeze({ currency: "USD" as const, minor: "500" }),
});
