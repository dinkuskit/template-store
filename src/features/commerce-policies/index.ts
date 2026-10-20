import { PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import { COMMERCE_PLUGIN_ID } from "@dinkuskit/commerce";
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

function validPolicy(value: unknown, kind: "shipping" | "returns"): boolean {
  if (value === null) return true;
  if (!object(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) ||
      value.revision < 1 || typeof value.updatedAt !== "string") return false;
  return kind === "shipping"
    ? value.recordKind === "store-shipping-policy" &&
      value.recordId === "active" &&
      typeof value.configurationId === "string" &&
      (value.mode === "free" || value.mode === "flat")
    : value.recordKind === "store-return-policy" && value.recordId === "active";
}

/**
 * The native plugin does not mount `policies/public`. Native hosts read the
 * same versioned records through the public store-policies export. Registry
 * installs keep the sandboxed public route and do not open storage here.
 */
async function readNativeDevelopmentPolicies(): Promise<PublicCommercePolicies> {
  const db = await getDb();
  return readPublicStorePoliciesFromStorage({
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
  });
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
  if (!result.success || !object(result.data) ||
      !validPolicy(result.data.shipping, "shipping") ||
      !validPolicy(result.data.returns, "returns")) {
    throw new Error("Invalid installed public policy projection");
  }
  return {
    shipping: result.data.shipping as StoreShippingPolicyRecord | null,
    returns: result.data.returns as StoreReturnPolicyRecord | null,
  };
}
