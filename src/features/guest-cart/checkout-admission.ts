import { COMMERCE_REGISTRY_RUNTIME_ID } from "./checkout-protocol.js";

export const SUPPORTED_GUEST_CHECKOUT_ROUTES = [
  "checkout/guest/prepare",
  "checkout/guest/start",
  "checkout/guest/status",
] as const;

export const CHECKOUT_READINESS_SCHEMA =
  "dinkuskit.commerce.checkout-readiness/v1" as const;
export const GUEST_CHECKOUT_READINESS_ROUTE =
  "checkout/guest/readiness" as const;

export interface RuntimeGuestCheckoutMetadata {
  getRuntimePluginSettingsSchema?(pluginId: string): Record<string, unknown> | null;
  getPluginRouteMeta?(
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

export type CheckoutReadinessResponse =
  | {
      readonly schema: typeof CHECKOUT_READINESS_SCHEMA;
      readonly status: "supported";
      readonly mode: "test";
    }
  | {
      readonly schema: typeof CHECKOUT_READINESS_SCHEMA;
      readonly status: "unavailable";
    };

export interface InstalledCheckoutRuntime extends RuntimeGuestCheckoutMetadata {
  handlePublicPluginApiRoute?(
    pluginId: string,
    method: string,
    path: string,
    request: Request,
  ): Promise<{ success: boolean; data?: unknown }>;
}

export interface InstalledCheckoutReadinessContext {
  runtime?: InstalledCheckoutRuntime | null;
  request?: Request | null;
}

/**
 * Strict parser for the exact checkout-readiness contract.
 * Rejects unknown shapes, extra fields, wrong schemas, non-test modes, and errors.
 */
export function parseCheckoutReadiness(data: unknown): CheckoutReadinessResponse | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");

  if (record.schema !== CHECKOUT_READINESS_SCHEMA) {
    return null;
  }

  if (record.status === "supported") {
    // Exact response: schema, status, mode: "test" (strictly 3 keys)
    if (keys !== "mode,schema,status" || record.mode !== "test") {
      return null;
    }
    return {
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "supported",
      mode: "test",
    };
  }

  if (record.status === "unavailable") {
    // Exact response: schema, status (strictly 2 keys)
    if (keys !== "schema,status") {
      return null;
    }
    return {
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "unavailable",
    };
  }

  return null;
}

/**
 * Query the installed Commerce runtime for checkout readiness advisory state.
 *
 * Calls GET checkout/guest/readiness via the same installed dispatcher and
 * namespace as catalog/public (r_gshdrqaldna3r7sn). Fails closed without native
 * fallback or browser credentials.
 */
export async function readInstalledCheckoutReadiness(
  context: InstalledCheckoutReadinessContext,
): Promise<CheckoutReadinessResponse | null> {
  const { runtime, request } = context;
  if (!runtime || !request || typeof runtime.handlePublicPluginApiRoute !== "function") {
    return null;
  }

  try {
    if (typeof runtime.getPluginRouteMeta === "function") {
      const meta = runtime.getPluginRouteMeta(COMMERCE_REGISTRY_RUNTIME_ID, GUEST_CHECKOUT_READINESS_ROUTE);
      if (!meta?.public || !meta.methods?.some((method) => method.toUpperCase() === "GET")) return null;
    }
    const url = new URL(
      `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/${GUEST_CHECKOUT_READINESS_ROUTE}`,
      request.url,
    );
    const result = await runtime.handlePublicPluginApiRoute(
      COMMERCE_REGISTRY_RUNTIME_ID,
      "GET",
      GUEST_CHECKOUT_READINESS_ROUTE,
      new Request(url, { method: "GET", cache: "no-store" }),
    );
    return result?.success === true ? parseCheckoutReadiness(result.data) : null;
  } catch {
    return null;
  }
}

/**
 * Validate authority already obtained from the installed public dispatcher.
 * Full runtimes expose additional metadata checks; anonymous EmDash pages expose
 * only the public dispatcher, which enforces route access in the original context.
 */
export function resolveGuestCheckoutAdmission(input: {
  runtime: RuntimeGuestCheckoutMetadata | null | undefined;
  catalog: SupportedCatalogCheckoutAuthority | null | undefined;
}): GuestCheckoutAdmission {
  if (!input.runtime || !input.catalog) return null;
  if (
    input.catalog.pluginId !== COMMERCE_REGISTRY_RUNTIME_ID ||
    input.catalog.sameCatalogNamespace !== true ||
    input.catalog.checkoutConfiguration !== "supported"
  ) {
    return null;
  }
  if (!hasInstalledGuestCheckoutRoutes(input.runtime)) return null;
  return {
    pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
    routes: SUPPORTED_GUEST_CHECKOUT_ROUTES,
    catalog: input.catalog,
  };
}

function hasInstalledGuestCheckoutRoutes(runtime: RuntimeGuestCheckoutMetadata): boolean {
  if (
    typeof runtime.getRuntimePluginSettingsSchema === "function" &&
    runtime.getRuntimePluginSettingsSchema(COMMERCE_REGISTRY_RUNTIME_ID) === null
  ) {
    return false;
  }
  if (typeof runtime.getPluginRouteMeta === "function") {
    for (const route of SUPPORTED_GUEST_CHECKOUT_ROUTES) {
      const metadata = runtime.getPluginRouteMeta(COMMERCE_REGISTRY_RUNTIME_ID, route);
      if (!metadata?.public || !metadata.methods?.some((method) => method.toUpperCase() === "POST")) return false;
    }
  }
  return true;
}

/** Existing capabilities reach Commerce's fresh start/status validation without
 * consulting its cached readiness advisory. This is routing permission only;
 * Commerce still validates the capability, configuration, binding and attempt. */
export function canDispatchInstalledGuestCheckout(context: InstalledCheckoutReadinessContext): boolean {
  if (process.env.DINKUS_CATALOG_PROFILE === "native-development") return false;
  return Boolean(context.runtime &&
    typeof context.runtime.handlePublicPluginApiRoute === "function" &&
    hasInstalledGuestCheckoutRoutes(context.runtime));
}

/**
 * Acquire checkout admission asynchronously by querying the installed Commerce
 * runtime's checkout readiness endpoint, validating the exact supported response,
 * and applying additional metadata exposed by the original runtime.
 */
export async function acquireGuestCheckoutAdmission(
  context: InstalledCheckoutReadinessContext,
): Promise<GuestCheckoutAdmission> {
  // Native-development catalog reads use a different storage namespace.
  if (process.env.DINKUS_CATALOG_PROFILE === "native-development") return null;
  const readiness = await readInstalledCheckoutReadiness(context);
  if (!readiness || readiness.status !== "supported" || readiness.mode !== "test") {
    return null;
  }

  const catalog: SupportedCatalogCheckoutAuthority = {
    pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
    sameCatalogNamespace: true,
    checkoutConfiguration: "supported",
  };

  try {
    return resolveGuestCheckoutAdmission({ runtime: context.runtime, catalog });
  } catch {
    return null;
  }
}
