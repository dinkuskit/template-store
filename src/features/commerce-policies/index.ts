import { PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import { COMMERCE_PLUGIN_ID, normalizeMoney } from "@dinkuskit/commerce";
import {
  readPublicStorePoliciesFromStorage,
  STORE_RETURN_POLICY_COLLECTION,
  STORE_SHIPPING_POLICY_COLLECTION,
  type StoreReturnPolicyRecord,
  type StoreShippingPolicyRecord,
} from "@dinkuskit/commerce/features/store-policies";

const ROUTE = "policies/public";

export interface InstalledPoliciesContext {
  request: Request;
  runtime: {
    getPluginRouteMeta?(pluginId: string, path: string): { public?: boolean; methods?: readonly string[] } | null;
    handlePublicPluginApiRoute(
      pluginId: string,
      method: string,
      path: string,
      request: Request,
    ): Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;
  } | null | undefined;
}

export interface PublicCommercePolicies {
  shipping: StoreShippingPolicyRecord | null;
  returns: StoreReturnPolicyRecord | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Validate the pinned Commerce public record shape before a page or JSON-LD
// consumes it. Policy input normalizers are not public exports; money is.
function optional(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === undefined || valid(value);
}

function countries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 250 &&
    value.every((country) => typeof country === "string" && /^[A-Z]{2}$/.test(country));
}

function dayBounds(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 2 &&
    typeof value.min === "number" && Number.isSafeInteger(value.min) && value.min >= 0 &&
    typeof value.max === "number" && Number.isSafeInteger(value.max) && value.max >= value.min && value.max <= 3650;
}

function policyUrl(value: unknown): boolean {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function choice(value: unknown, allowed: readonly string[]): boolean {
  return optional(value, (entry) => typeof entry === "string" && allowed.includes(entry));
}

function shippingAmount(value: unknown, mode: unknown): boolean {
  if (value === undefined) return mode === "free";
  try {
    const amount = normalizeMoney(value, "shipping.amount");
    return mode !== "free" || amount.minor === "0";
  } catch {
    return false;
  }
}

function validPolicy(value: unknown, kind: "shipping" | "returns"): boolean {
  if (value === null) return true;
  if (!object(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) ||
      value.revision < 1 || typeof value.updatedAt !== "string") return false;
  return kind === "shipping"
    ? value.recordKind === "store-shipping-policy" &&
      value.recordId === "active" &&
      typeof value.configurationId === "string" && value.configurationId.trim().length > 0 && value.configurationId.length <= 1024 &&
      (value.mode === "free" || value.mode === "flat") && shippingAmount(value.amount, value.mode) &&
      optional(value.shippingDestinationCountries, countries) &&
      optional(value.handlingTimeDays, dayBounds) && optional(value.transitTimeDays, dayBounds) &&
      optional(value.policyPageUrl, policyUrl)
    : value.recordKind === "store-return-policy" && value.recordId === "active" &&
      optional(value.applicableCountry, countries) &&
      choice(value.returnPolicyCategory, ["MerchantReturnFiniteReturnWindow", "MerchantReturnNotPermitted", "MerchantReturnUnlimitedWindow"]) &&
      choice(value.returnMethod, ["ReturnByMail", "ReturnInStore", "ReturnAtKiosk"]) &&
      choice(value.returnFees, ["FreeReturn", "ReturnFeesCustomerResponsibility", "ReturnShippingFees"]) &&
      optional(value.merchantReturnDays, (days) => typeof days === "number" && Number.isSafeInteger(days) && days >= 0 && days <= 3650) &&
      optional(value.policyPageUrl, policyUrl);
}

function policyProjection(value: unknown): PublicCommercePolicies {
  if (!object(value) || !validPolicy(value.shipping, "shipping") || !validPolicy(value.returns, "returns")) {
    throw new Error("Invalid installed public policy projection");
  }
  return {
    shipping: value.shipping as StoreShippingPolicyRecord | null,
    returns: value.returns as StoreReturnPolicyRecord | null,
  };
}

/**
 * The native plugin does not mount `policies/public`. Native hosts read the
 * same versioned records through the public store-policies export. Registry
 * installs keep the sandboxed public route and do not open storage here.
 */
async function readNativeDevelopmentPolicies(): Promise<PublicCommercePolicies> {
  const db = await getDb();
  return policyProjection(await readPublicStorePoliciesFromStorage({
    shipping: new PluginStorageRepository<StoreShippingPolicyRecord>(
      db,
      COMMERCE_PLUGIN_ID,
      STORE_SHIPPING_POLICY_COLLECTION,
      [],
    ),
    returns: new PluginStorageRepository<StoreReturnPolicyRecord>(
      db,
      COMMERCE_PLUGIN_ID,
      STORE_RETURN_POLICY_COLLECTION,
      [],
    ),
  }));
}

function publicPolicyRoute(
  runtime: NonNullable<InstalledPoliciesContext["runtime"]>,
  pluginId: string,
): boolean {
  if (typeof runtime.handlePublicPluginApiRoute !== "function") return false;
  if (typeof runtime.getPluginRouteMeta !== "function") return true;
  const meta = runtime.getPluginRouteMeta(pluginId, ROUTE);
  return meta?.public === true && meta.methods?.includes("GET") === true;
}

export async function readInstalledCommercePolicies(
  { runtime, request }: InstalledPoliciesContext,
  pluginId: string,
): Promise<PublicCommercePolicies> {
  if (!runtime || !publicPolicyRoute(runtime, pluginId)) {
    if (process.env.DINKUS_CATALOG_PROFILE === "native-development") {
      return readNativeDevelopmentPolicies();
    }
    throw new Error("Installed public policy route unavailable");
  }
  const url = new URL(`/_emdash/api/plugins/${pluginId}/${ROUTE}`, request.url);
  const result = await runtime.handlePublicPluginApiRoute(
    pluginId,
    "GET",
    ROUTE,
    new Request(url, { method: "GET" }),
  );
  // The storefront runtime may only expose the public dispatcher. A missing
  // `policies/public` route is reported as NOT_FOUND, including on the native
  // plugin, which does not mount it. Native hosts then read the same records.
  if (!result.success && result.error?.code === "NOT_FOUND" &&
      process.env.DINKUS_CATALOG_PROFILE === "native-development") {
    return readNativeDevelopmentPolicies();
  }
  if (!result.success) {
    throw new Error("Invalid installed public policy projection");
  }
  return policyProjection(result.data);
}
