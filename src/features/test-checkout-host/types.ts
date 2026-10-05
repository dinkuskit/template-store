/**
 * TEST Checkout Host types for Payments wake transport and Commerce reconciliation.
 *
 * Adopts canonical types from `@dinkuskit/commerce/features/checkout`
 * matching the reviewed pre-release Commerce source 444b0505ae061c58e2f738e9f39fb0b366d50e8c.
 */

import type {
  CheckoutAttempt,
  CheckoutExecution,
  CheckoutPaymentAssociationPort,
  CommercePaymentWake,
  CommercePaymentWakePort,
  ScopedPaymentFetch,
  TrustedTestPaymentsCheckoutHost,
  TrustedTestPaymentsConfig,
  WakeReconciliationResult,
} from "@dinkuskit/commerce/features/checkout";

export type {
  CheckoutAttempt,
  CheckoutExecution,
  CheckoutPaymentAssociationPort,
  CommercePaymentWake,
  CommercePaymentWakePort,
  ScopedPaymentFetch,
  TrustedTestPaymentsCheckoutHost,
  TrustedTestPaymentsConfig,
  WakeReconciliationResult,
};

/**
 * Shared FULL trusted TEST factory configuration.
 *
 * Shared directly between the Commerce checkout host
 * (`createTrustedTestPaymentsCheckoutHost`) and the Payments wake transport client
 * (`createTestPaymentsWakeClient`).
 */
export interface TrustedTestCheckoutHostConfig extends TrustedTestPaymentsConfig {
  /** Optional limit on number of wakes fetched per request (1..100, default 25) */
  readonly limit?: number;
}

export type TestPaymentsWakeClientConfig = TrustedTestCheckoutHostConfig;

export interface SchedulerDriverExecutionResult {
  readonly executed: boolean;
  readonly reason?: "not_configured" | "integration_limit_unsupported" | "error";
  readonly processedCount: number;
  readonly results: readonly WakeReconciliationResult[];
}

/**
 * Honest source-level integration limit identifier.
 *
 * In EmDash 1.0.1, plugin descriptor options in Astro configuration are serialized
 * via JSON.stringify into virtual modules, which strips all function properties
 * (including credentialResolver and resolvePayments). Furthermore, while EmDash's
 * `withEmDashRuntime` middleware provides access to the request-less runtime singleton,
 * it supports `runtime.handlePluginApiRoute(...)` only for registered routes.
 *
 * Direct SQL bypass or invented unauthenticated plugin routes are strictly prohibited.
 * EmDash has plugin cron contexts; no installed-plugin checkout host/storage
 * injection is attested in this starter. Admission requires that supported
 * context and the trusted host callbacks, rather than a new public route.
 */
export const REGISTRY_HOST_INJECTION_LIMITATION =
  "INSTALLED_CHECKOUT_HOST_CONTEXT_NOT_ADMITTED";
