import { describe, expect, it } from "vitest";

import {
  COMMERCE_REGISTRY_RUNTIME_ID,
  resolveGuestCheckoutAdmission,
  SUPPORTED_GUEST_CHECKOUT_ROUTES,
} from "../../src/features/guest-cart/index.js";

function runtime() {
  return {
    getRuntimePluginSettingsSchema: (id: string) =>
      id === COMMERCE_REGISTRY_RUNTIME_ID ? {} : null,
    getPluginRouteMeta: (id: string, path: string) =>
      id === COMMERCE_REGISTRY_RUNTIME_ID && SUPPORTED_GUEST_CHECKOUT_ROUTES.includes(
        path as (typeof SUPPORTED_GUEST_CHECKOUT_ROUTES)[number],
      )
        ? { public: true, methods: ["POST"] }
        : null,
  };
}

describe("guest checkout installed admission", () => {
  it("stays closed without Core same-catalog/config authority", () => {
    expect(resolveGuestCheckoutAdmission({ runtime: runtime(), catalog: null })).toBeNull();
  });

  it("requires genuine runtime metadata and the exact authority identity", () => {
    expect(resolveGuestCheckoutAdmission({
      runtime: null,
      catalog: {
        pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
        sameCatalogNamespace: true,
        checkoutConfiguration: "supported",
      },
    })).toBeNull();
    expect(resolveGuestCheckoutAdmission({
      runtime: runtime(),
      catalog: {
        pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
        sameCatalogNamespace: true,
        checkoutConfiguration: "supported",
      },
    })).not.toBeNull();
  });
});
