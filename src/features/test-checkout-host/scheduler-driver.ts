import {
  createTrustedTestPaymentsCheckoutHost,
  reconcilePaymentWakes,
  type CheckoutExecution,
  type CheckoutPaymentAssociationPort,
  type CommercePaymentWakePort,
  type TrustedTestPaymentsCheckoutHost,
  type WakeReconciliationResult,
} from "@dinkuskit/commerce/features/checkout";

import type {
  SchedulerDriverExecutionResult,
  TrustedTestCheckoutHostConfig,
} from "./types.js";
import { createTestPaymentsWakeClient } from "./wake-client.js";

export interface TrustedTestCheckoutHostAssembly {
  readonly checkoutHost: TrustedTestPaymentsCheckoutHost;
  readonly wakePort: CommercePaymentWakePort;
  readonly config: Readonly<TrustedTestCheckoutHostConfig>;
}

/**
 * Creates the complete in-process trusted TEST checkout host assembly,
 * sharing the FULL trusted configuration (origin, siteId, bindingRef,
 * stripeAccountId, server credential resolver, and scoped fetch)
 * between the Commerce checkout host and the Payments wake transport client.
 */
export function createTrustedTestCheckoutHostAssembly(
  config: TrustedTestCheckoutHostConfig,
): TrustedTestCheckoutHostAssembly {
  const snapshot = Object.freeze({ ...config });
  const checkoutHost = createTrustedTestPaymentsCheckoutHost(snapshot);
  const wakePort = createTestPaymentsWakeClient(snapshot);

  return Object.freeze({
    checkoutHost,
    wakePort,
    config: snapshot,
  });
}

/**
 * Executes reconciliation of payment wakes against canonical checkout store
 * and payment associations using canonical Commerce factories and types.
 */
export async function runWakeReconciliation(
  execution: CheckoutExecution,
  associations: CheckoutPaymentAssociationPort,
  wakePort: CommercePaymentWakePort,
): Promise<readonly WakeReconciliationResult[]> {
  const results = await reconcilePaymentWakes(execution, associations, wakePort);
  return Object.freeze([...results]);
}

export interface ScheduledWakeReconciliationOptions {
  readonly config?: TrustedTestCheckoutHostConfig;
  readonly execution?: CheckoutExecution;
  readonly associations?: CheckoutPaymentAssociationPort;
}

/**
 * Platform scheduler driver entry point.
 *
 * Honors the honest source-level integration limit:
 * Descriptor JSON cannot carry the trusted host callbacks. An admitted
 * installed-plugin execution/storage context must be supplied separately.
 * This driver does not invent routes or access storage through raw SQL.
 */
export async function runScheduledWakeReconciliation(
  options?: ScheduledWakeReconciliationOptions,
): Promise<SchedulerDriverExecutionResult> {
  if (!options?.config) {
    return {
      executed: false,
      reason: "not_configured",
      processedCount: 0,
      results: [],
    };
  }

  if (!options.execution || !options.associations) {
    return {
      executed: false,
      reason: "integration_limit_unsupported",
      processedCount: 0,
      results: [],
    };
  }

  try {
    const assembly = createTrustedTestCheckoutHostAssembly(options.config);
    if (options.execution.paymentBindingRef !== assembly.checkoutHost.paymentBindingRef) {
      return { executed: false, reason: "error", processedCount: 0, results: [] };
    }

  // Admit only the caller's trusted storage/catalog/inventory/clock/association
  // authority; payment authority and wake transport come from one full config.
    const admittedExecution: CheckoutExecution = Object.freeze({
      ...options.execution,
      paymentBindingRef: assembly.checkoutHost.paymentBindingRef,
      resolvePayments: assembly.checkoutHost.resolvePayments,
    });
    const results = await runWakeReconciliation(
      admittedExecution,
      options.associations,
      assembly.wakePort,
    );
    return {
      executed: true,
      processedCount: results.length,
      results,
    };
  } catch {
    return {
      executed: false,
      reason: "error",
      processedCount: 0,
      results: [],
    };
  }
}
