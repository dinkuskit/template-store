import { afterEach, describe, expect, it, vi } from "vitest";

const merchEntries = [
  {
    id: "boxy-tee-preview",
    data: {
      title: "Boxy Tee",
      category: "Tees",
      description: "Preview",
      visual_label: "TEE",
    },
  },
] as const;

const managedRuntime = "../../src/features/managed-product-availability/index.js";
const unmanagedRuntime = "../../src/features/unmanaged-product-sellability/index.js";

afterEach(() => {
  vi.doUnmock(managedRuntime);
  vi.doUnmock(unmanagedRuntime);
  vi.resetModules();
});

function createDemonstrationFactories(): {
  evaluations: { managed: number; unmanaged: number };
  mockManaged: () => never;
  mockUnmanaged: () => never;
} {
  const evaluations = { managed: 0, unmanaged: 0 };
  return {
    evaluations,
    mockManaged() {
      evaluations.managed += 1;
      throw new Error("managed demonstration factory evaluated");
    },
    mockUnmanaged() {
      evaluations.unmanaged += 1;
      throw new Error("unmanaged demonstration factory evaluated");
    },
  };
}

describe("shipping loader isolation", () => {
  it("bootstraps the shipping loader without evaluating demonstration runtime modules", async () => {
    vi.resetModules();
    const { evaluations, mockManaged, mockUnmanaged } = createDemonstrationFactories();
    vi.doMock(managedRuntime, mockManaged);
    vi.doMock(unmanagedRuntime, mockUnmanaged);
    const { loadStorefrontRouteContext } = await import(
      "../../src/features/store-shell/storefront-route.js"
    );
    await expect(
      loadStorefrontRouteContext(merchEntries, {
        DINKUS_STOREFRONT_PROFILE: "shipping",
      }),
    ).resolves.toMatchObject({
      profile: "shipping",
      demonstrations: null,
    });
    expect(evaluations.managed).toBe(0);
    expect(evaluations.unmanaged).toBe(0);
  });

  it("proof profile evaluates demonstration runtime modules and rejects", async () => {
    vi.resetModules();
    const { evaluations, mockManaged, mockUnmanaged } = createDemonstrationFactories();
    vi.doMock(managedRuntime, mockManaged);
    vi.doMock(unmanagedRuntime, mockUnmanaged);
    const { loadStorefrontRouteContext } = await import(
      "../../src/features/store-shell/storefront-route.js"
    );
    await expect(
      loadStorefrontRouteContext(merchEntries, {
        DINKUS_STOREFRONT_PROFILE: "proof",
      }),
    ).rejects.toThrow();
    expect(evaluations.managed).toBeGreaterThan(0);
    expect(evaluations.unmanaged).toBeGreaterThan(0);
  });
});
