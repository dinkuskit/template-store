import { COMMERCE_REGISTRY_RUNTIME_ID } from "./checkout-protocol.js";

export const SUPPORTED_GUEST_CHECKOUT_ROUTES = [
  "checkout/guest/prepare",
  "checkout/guest/start",
  "checkout/guest/status",
] as const;

export interface RuntimeGuestCheckoutMetadata {
  getRuntimePluginSettingsSchema(pluginId: string): Record<string, unknown> | null;
  getPluginRouteMeta(
    pluginId: string,
    path: string,
  ): { public?: boolean; methods?: readonly string[] } | null;
}

export interface SupportedCatalogCheckoutAuthority {
  readonly pluginId: typeof COMMERCE_REGISTRY_RUNTIME_ID;
  readonly sameCatalogNamespace: true;
  readonly checkoutConfiguration: "supported";
}

export type GuestCheckoutAdmission =
  | Readonly<{
      pluginId: typeof COMMERCE_REGISTRY_RUNTIME_ID;
      routes: typeof SUPPORTED_GUEST_CHECKOUT_ROUTES;
      catalog: SupportedCatalogCheckoutAuthority;
    }>
  | null;

/**
 * Registry metadata is necessary but insufficient for shipping admission.
 * The catalog/config authority is deliberately supplied by Core only; native
 * `dinkus-commerce` metadata and source aliases cannot satisfy this resolver.
 */
export function resolveGuestCheckoutAdmission(input: {
  runtime: RuntimeGuestCheckoutMetadata | null | undefined;
  catalog: SupportedCatalogCheckoutAuthority | null | undefined;
}): GuestCheckoutAdmission {
  if (!input.runtime || !input.catalog) return null;
  if (input.catalog.pluginId !== COMMERCE_REGISTRY_RUNTIME_ID ||
      input.catalog.sameCatalogNamespace !== true ||
      input.catalog.checkoutConfiguration !== "supported") return null;
  if (input.runtime.getRuntimePluginSettingsSchema(COMMERCE_REGISTRY_RUNTIME_ID) === null) {
    return null;
  }
  for (const route of SUPPORTED_GUEST_CHECKOUT_ROUTES) {
    const metadata = input.runtime.getPluginRouteMeta(COMMERCE_REGISTRY_RUNTIME_ID, route);
    if (!metadata?.public ||
        !metadata.methods?.some((method) => method.toUpperCase() === "POST")) {
      return null;
    }
  }
  return {
    pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
    routes: SUPPORTED_GUEST_CHECKOUT_ROUTES,
    catalog: input.catalog,
  };
}
