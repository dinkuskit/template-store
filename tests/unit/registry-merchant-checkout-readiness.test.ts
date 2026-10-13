import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_READINESS_SCHEMA,
  GUEST_CHECKOUT_READINESS_ROUTE,
  SUPPORTED_GUEST_CHECKOUT_ROUTES,
  acquireGuestCheckoutAdmission,
  parseCheckoutReadiness,
  readInstalledCheckoutReadiness,
  resolveGuestCheckoutAdmission,
  type InstalledCheckoutRuntime,
} from "../../src/features/guest-cart/checkout-admission.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../../src/features/guest-cart/checkout-protocol.js";

const SITE = "https://store.example.test";
afterEach(() => vi.unstubAllEnvs());

function createValidRuntime(overrides: Partial<InstalledCheckoutRuntime> = {}): InstalledCheckoutRuntime {
  return {
    getRuntimePluginSettingsSchema: (pluginId: string) =>
      pluginId === COMMERCE_REGISTRY_RUNTIME_ID ? {} : null,
    getPluginRouteMeta: (pluginId: string, path: string) => {
      if (pluginId !== COMMERCE_REGISTRY_RUNTIME_ID) return null;
      if (path === GUEST_CHECKOUT_READINESS_ROUTE) {
        return { public: true, methods: ["GET"] };
      }
      if (
        SUPPORTED_GUEST_CHECKOUT_ROUTES.includes(
          path as (typeof SUPPORTED_GUEST_CHECKOUT_ROUTES)[number],
        )
      ) {
        return { public: true, methods: ["POST"] };
      }
      return null;
    },
    handlePublicPluginApiRoute: vi.fn(async (pluginId, method, path, _request) => {
      if (
        pluginId === COMMERCE_REGISTRY_RUNTIME_ID &&
        method === "GET" &&
        path === GUEST_CHECKOUT_READINESS_ROUTE
      ) {
        return {
          success: true,
          data: {
            schema: CHECKOUT_READINESS_SCHEMA,
            status: "supported",
            mode: "test",
          },
        };
      }
      return { success: false, error: { code: "NOT_FOUND", message: "Not found" } };
    }),
    ...overrides,
  };
}

describe("parseCheckoutReadiness contract validation", () => {
  it("accepts exact supported test response", () => {
    const parsed = parseCheckoutReadiness({
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "supported",
      mode: "test",
    });
    expect(parsed).toEqual({
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "supported",
      mode: "test",
    });
  });

  it("accepts exact unavailable response", () => {
    const parsed = parseCheckoutReadiness({
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "unavailable",
    });
    expect(parsed).toEqual({
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "unavailable",
    });
  });

  it("rejects unknown extra fields on supported response", () => {
    expect(
      parseCheckoutReadiness({
        schema: CHECKOUT_READINESS_SCHEMA,
        status: "supported",
        mode: "test",
        extraField: "forbidden",
      }),
    ).toBeNull();
  });

  it("rejects unknown extra fields on unavailable response", () => {
    expect(
      parseCheckoutReadiness({
        schema: CHECKOUT_READINESS_SCHEMA,
        status: "unavailable",
        reason: "payments_down",
      }),
    ).toBeNull();
  });

  it("rejects non-test mode (e.g. live or staging)", () => {
    expect(
      parseCheckoutReadiness({
        schema: CHECKOUT_READINESS_SCHEMA,
        status: "supported",
        mode: "live",
      }),
    ).toBeNull();

    expect(
      parseCheckoutReadiness({
        schema: CHECKOUT_READINESS_SCHEMA,
        status: "supported",
        mode: "staging",
      }),
    ).toBeNull();
  });

  it("rejects wrong or unknown schema identifiers", () => {
    expect(
      parseCheckoutReadiness({
        schema: "dinkuskit.commerce.checkout-readiness/v2",
        status: "supported",
        mode: "test",
      }),
    ).toBeNull();

    expect(
      parseCheckoutReadiness({
        schema: "unknown-schema",
        status: "supported",
        mode: "test",
      }),
    ).toBeNull();
  });

  it("rejects null, non-objects, arrays, and partial shapes", () => {
    expect(parseCheckoutReadiness(null)).toBeNull();
    expect(parseCheckoutReadiness(undefined)).toBeNull();
    expect(parseCheckoutReadiness("supported")).toBeNull();
    expect(parseCheckoutReadiness(123)).toBeNull();
    expect(parseCheckoutReadiness([])).toBeNull();
    expect(parseCheckoutReadiness({})).toBeNull();
    expect(
      parseCheckoutReadiness({
        schema: CHECKOUT_READINESS_SCHEMA,
        status: "supported",
      }),
    ).toBeNull();
  });
});

describe("readInstalledCheckoutReadiness runtime dispatcher integration", () => {
  it("fails closed when runtime or request is absent", async () => {
    const request = new Request(`${SITE}/cart`);
    expect(await readInstalledCheckoutReadiness({ runtime: null, request })).toBeNull();
    expect(
      await readInstalledCheckoutReadiness({
        runtime: createValidRuntime(),
        request: null,
      }),
    ).toBeNull();
  });

  it("rejects when readiness route is missing or private in route metadata", async () => {
    const request = new Request(`${SITE}/cart`);
    const runtimeWithoutRoute = createValidRuntime({
      getPluginRouteMeta: () => null,
    });
    expect(
      await readInstalledCheckoutReadiness({ runtime: runtimeWithoutRoute, request }),
    ).toBeNull();

    const runtimePrivate = createValidRuntime({
      getPluginRouteMeta: (_id, path) =>
        path === GUEST_CHECKOUT_READINESS_ROUTE
          ? { public: false, methods: ["GET"] }
          : null,
    });
    expect(
      await readInstalledCheckoutReadiness({ runtime: runtimePrivate, request }),
    ).toBeNull();

    const runtimeWrongMethod = createValidRuntime({
      getPluginRouteMeta: (_id, path) =>
        path === GUEST_CHECKOUT_READINESS_ROUTE
          ? { public: true, methods: ["POST"] }
          : null,
    });
    expect(
      await readInstalledCheckoutReadiness({ runtime: runtimeWrongMethod, request }),
    ).toBeNull();
  });

  it("dispatches GET without forwarding client credentials or request body", async () => {
    const clientRequest = new Request(`${SITE}/cart`, {
      method: "GET",
      headers: {
        cookie: "session=client-secret",
        authorization: "Bearer client-token",
      },
    });

    let receivedRequest: Request | null = null;
    const runtime = createValidRuntime({
      handlePublicPluginApiRoute: vi.fn(async (_pluginId, _method, _path, request) => {
        receivedRequest = request;
        return {
          success: true,
          data: {
            schema: CHECKOUT_READINESS_SCHEMA,
            status: "supported",
            mode: "test",
          },
        };
      }),
    });

    const res = await readInstalledCheckoutReadiness({ runtime, request: clientRequest });
    expect(res).toEqual({
      schema: CHECKOUT_READINESS_SCHEMA,
      status: "supported",
      mode: "test",
    });

    expect(receivedRequest).not.toBeNull();
    expect(receivedRequest!.method).toBe("GET");
    expect(new URL(receivedRequest!.url).origin).toBe(SITE);
    expect(receivedRequest!.headers.get("cookie")).toBeNull();
    expect(receivedRequest!.headers.get("authorization")).toBeNull();
  });

  it("handles dispatcher exceptions and unsuccessful responses cleanly", async () => {
    const request = new Request(`${SITE}/cart`);
    const throwingRuntime = createValidRuntime({
      handlePublicPluginApiRoute: vi.fn(async () => {
        throw new Error("transport collision");
      }),
    });
    expect(
      await readInstalledCheckoutReadiness({ runtime: throwingRuntime, request }),
    ).toBeNull();

    const failureRuntime = createValidRuntime({
      handlePublicPluginApiRoute: vi.fn(async () => ({ success: false })),
    });
    expect(
      await readInstalledCheckoutReadiness({ runtime: failureRuntime, request }),
    ).toBeNull();
  });
});

describe("acquireGuestCheckoutAdmission end-to-end admission gate", () => {
  it("grants admission when readiness is supported test mode and metadata passes", async () => {
    const request = new Request(`${SITE}/cart`);
    const runtime = createValidRuntime();

    const admission = await acquireGuestCheckoutAdmission({ runtime, request });
    expect(admission).not.toBeNull();
    expect(admission?.pluginId).toBe(COMMERCE_REGISTRY_RUNTIME_ID);
    expect(admission?.catalog).toEqual({
      pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
      sameCatalogNamespace: true,
      checkoutConfiguration: "supported",
    });
    expect(admission?.routes).toEqual(SUPPORTED_GUEST_CHECKOUT_ROUTES);
  });

  it("stays closed when readiness returns unavailable", async () => {
    const request = new Request(`${SITE}/cart`);
    const runtime = createValidRuntime({
      handlePublicPluginApiRoute: vi.fn(async () => ({
        success: true,
        data: {
          schema: CHECKOUT_READINESS_SCHEMA,
          status: "unavailable",
        },
      })),
    });

    const admission = await acquireGuestCheckoutAdmission({ runtime, request });
    expect(admission).toBeNull();
  });

  it("stays closed when plugin settings schema is absent (unconfigured)", async () => {
    const request = new Request(`${SITE}/cart`);
    const runtime = createValidRuntime({
      getRuntimePluginSettingsSchema: () => null,
    });

    const admission = await acquireGuestCheckoutAdmission({ runtime, request });
    expect(admission).toBeNull();
  });

  it("stays closed when any checkout POST route is missing from runtime metadata", async () => {
    const request = new Request(`${SITE}/cart`);
    const runtime = createValidRuntime({
      getPluginRouteMeta: (_pluginId, path) => {
        if (path === GUEST_CHECKOUT_READINESS_ROUTE) {
          return { public: true, methods: ["GET"] };
        }
        if (path === "checkout/guest/prepare") {
          return { public: true, methods: ["POST"] };
        }
        // missing start and status
        return null;
      },
    });

    const admission = await acquireGuestCheckoutAdmission({ runtime, request });
    expect(admission).toBeNull();
  });

  it("refuses native dinkus-commerce authority synthesis", () => {
    const runtime = createValidRuntime();
    expect(
      resolveGuestCheckoutAdmission({
        runtime: runtime as any,
        catalog: {
          pluginId: "dinkus-commerce" as any,
          sameCatalogNamespace: true,
          checkoutConfiguration: "supported",
        },
      }),
    ).toBeNull();
  });
});


describe("anonymous installed admission", () => {
  it("admits EmDash's public-only anonymous dispatcher", async () => {
    const full = createValidRuntime();
    const runtime = { handlePublicPluginApiRoute: full.handlePublicPluginApiRoute };
    const admission = await acquireGuestCheckoutAdmission({ runtime, request: new Request(`${SITE}/cart`) });
    expect(admission?.pluginId).toBe(COMMERCE_REGISTRY_RUNTIME_ID);
  });

  it("never pairs a native-development catalog with Registry checkout", async () => {
    vi.stubEnv("DINKUS_CATALOG_PROFILE", "native-development");
    const runtime = createValidRuntime();
    expect(await acquireGuestCheckoutAdmission({ runtime, request: new Request(`${SITE}/cart`) })).toBeNull();
    expect(runtime.handlePublicPluginApiRoute).not.toHaveBeenCalled();
  });

  it("fails closed when optional runtime metadata throws", async () => {
    const runtime = createValidRuntime({ getPluginRouteMeta: () => { throw new Error("runtime unavailable"); } });
    await expect(acquireGuestCheckoutAdmission({ runtime, request: new Request(`${SITE}/cart`) })).resolves.toBeNull();
  });
});
