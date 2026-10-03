/**
 * TEST Checkout Host adapter and scheduler slice.
 *
 * Implements exact-origin Payments wake transport client and Cloudflare
 * scheduler driver for canonical Commerce wake reconciliation.
 */

export * from "./types.js";
export {
  assertValidWakeSnapshot,
  createTestPaymentsWakeClient,
  isValidWakeSnapshot,
  MAX_WAKE_LIST_RESPONSE_BYTES,
  MAX_WAKE_ACK_RESPONSE_BYTES,
} from "./wake-client.js";
export {
  createTrustedTestCheckoutHostAssembly,
  runScheduledWakeReconciliation,
  runWakeReconciliation,
  type ScheduledWakeReconciliationOptions,
  type TrustedTestCheckoutHostAssembly,
} from "./scheduler-driver.js";
