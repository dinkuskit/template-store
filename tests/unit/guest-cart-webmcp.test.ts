import { describe, expect, it, vi } from "vitest";
import {
  GUEST_CART_STORAGE_KEY,
  WEBMCP_ANTI_SCRAPE_NOTICE,
  WEBMCP_REGISTRATION_SYMBOL,
  buildStorefrontWebMcpTools,
  computeCartReviewFingerprint,
  createStorefrontActions,
  installStorefrontWebMcp,
  type GuestCartCatalogSnapshot,
  type GuestCartStoragePort,
  type ModelContextHost,
  type WebMcpToolDescriptor,
} from "../../src/features/guest-cart/index.js";

function createMemoryStorage(): GuestCartStoragePort & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const CATALOG_FIXTURES: readonly GuestCartCatalogSnapshot[] = [
  {
    id: "prod_hoodie",
    found: true,
    name: "Heavyweight Hoodie",
    sku: "HD-01",
    fulfillment: "physical",
    thumbnail: null,
    price: {
      listable: true,
      regularText: "$65.00",
      saleText: null,
      unitMinor: "6500",
    },
    availability: {
      status: "in-stock",
      sellable: true,
      listable: true,
    },
  },
  {
    id: "prod_cap",
    found: true,
    name: "Canvas Cap",
    sku: "CP-02",
    fulfillment: "physical",
    thumbnail: null,
    price: {
      listable: true,
      regularText: "$28.00",
      saleText: null,
      unitMinor: "2800",
    },
    availability: {
      status: "in-stock",
      sellable: true,
      listable: true,
    },
  },
  {
    id: "prod_soldout",
    found: true,
    name: "Sold Out Mug",
    sku: "MG-03",
    fulfillment: "physical",
    thumbnail: null,
    price: {
      listable: true,
      regularText: "$18.00",
      saleText: null,
      unitMinor: "1800",
    },
    availability: {
      status: "out-of-stock",
      sellable: false,
      listable: true,
    },
  },
];

async function fetchFixtureSnapshots(
  ids: readonly string[],
): Promise<readonly GuestCartCatalogSnapshot[]> {
  return ids.map(
    (id) =>
      CATALOG_FIXTURES.find((entry) => entry.id === id) ?? {
        id,
        found: false as const,
      },
  );
}

describe("storefront actions and progressive WebMCP adapter", () => {
  it("exposes frozen window.Dinkus.actions and skips tool registration when modelContext is absent", async () => {
    const storage = createMemoryStorage();
    const globalTarget: Record<string, unknown> = {};
    const result = installStorefrontWebMcp({
      storage,
      fetchSnapshot: fetchFixtureSnapshots,
      modelContext: null,
      globalTarget,
    });

    expect(result.webMcpRegistered).toBe(false);
    expect(result.toolNames).toEqual([]);
    expect(Object.isFrozen(globalTarget.Dinkus)).toBe(true);
    const dinkus = globalTarget.Dinkus as { actions: typeof result.actions };
    expect(Object.isFrozen(dinkus.actions)).toBe(true);
    expect(buildStorefrontWebMcpTools(dinkus.actions)).toHaveLength(6);

    const empty = await dinkus.actions.getCart();
    expect(empty.itemCount).toBe(0);
    expect(empty.subtotalMinor).toBe(0);
    expect(empty.reviewFingerprint).toBe("cart:empty");
  });

  it("batches merge and full-PUT replace cart updates with integer minor-unit totals and events", async () => {
    const storage = createMemoryStorage();
    const events: Array<{ name: string; detail: unknown }> = [];
    const actions = createStorefrontActions({
      storage,
      fetchSnapshot: fetchFixtureSnapshots,
      dispatchEvent: (name, detail) => events.push({ name, detail }),
    });

    const added = await actions.updateCart({
      mode: "merge",
      lines: [
        { id: "prod_hoodie", quantity: 2 },
        { id: "prod_cap", quantity: 1 },
      ],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.cart.itemCount).toBe(3);
    expect(added.cart.subtotalMinor).toBe(6500 * 2 + 2800);
    expect(events.at(-1)?.name).toBe("dinkus:cart:updated");

    // Full-replacement (PUT) mode omits prod_hoodie to remove it and updates prod_cap to 3.
    const replaced = await actions.updateCart({
      mode: "replace",
      lines: [{ id: "prod_cap", quantity: 3 }],
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.cart.lines).toHaveLength(1);
    expect(replaced.cart.lines[0]?.id).toBe("prod_cap");
    expect(replaced.cart.lines[0]?.quantity).toBe(3);
    expect(replaced.cart.subtotalMinor).toBe(2800 * 3);

    // Full-replacement rejects quantity: 0 with anti-DOM-scraping instruction.
    const zeroInReplace = await actions.updateCart({
      mode: "replace",
      lines: [{ id: "prod_cap", quantity: 0 }],
    });
    expect(zeroInReplace.ok).toBe(false);
    if (zeroInReplace.ok) return;
    expect(zeroInReplace.code).toBe("INVALID_QUANTITY");
    expect(zeroInReplace.instruction).toBe(WEBMCP_ANTI_SCRAPE_NOTICE);
    expect(events.at(-1)?.name).toBe("dinkus:cart:error");
  });

  it("registers all 6 WebMCP tools once with untrustedContentHint and enforces the 2-step buyer_review_required gate", async () => {
    const storage = createMemoryStorage();
    const registered: WebMcpToolDescriptor[] = [];
    const modelContext: ModelContextHost = {
      registerTool: vi.fn((tool: WebMcpToolDescriptor) => {
        registered.push(tool);
      }),
    };
    const navigated: string[] = [];
    const globalTarget: Record<string, unknown> = {};

    const firstInstall = installStorefrontWebMcp({
      storage,
      fetchSnapshot: fetchFixtureSnapshots,
      navigate: (path) => navigated.push(path),
      modelContext,
      globalTarget,
    });
    expect(firstInstall.webMcpRegistered).toBe(true);
    expect(firstInstall.toolNames).toEqual([
      "get_cart",
      "add_to_cart",
      "update_cart_lines",
      "cancel_cart",
      "get_checkout_preview",
      "proceed_to_checkout",
    ]);
    expect(registered).toHaveLength(6);
    expect(modelContext[WEBMCP_REGISTRATION_SYMBOL]).toBe(true);

    // Every tool must carry untrustedContentHint: true; only proceed_to_checkout carries consequentialHint: true.
    for (const tool of registered) {
      expect(tool.annotations.untrustedContentHint).toBe(true);
      expect(tool.annotations.consequentialHint).toBe(tool.name === "proceed_to_checkout");
    }

    // Second install on the same modelContext is idempotent.
    installStorefrontWebMcp({
      storage,
      fetchSnapshot: fetchFixtureSnapshots,
      modelContext,
      globalTarget,
    });
    expect(registered).toHaveLength(6);

    const byName = new Map(registered.map((tool) => [tool.name, tool]));
    await byName.get("add_to_cart")!.execute({ id: "prod_hoodie", quantity: 1 });
    // Repeated add_to_cart increments existing line quantity (1 -> 3).
    const secondAdd = (await byName.get("add_to_cart")!.execute({
      id: "prod_hoodie",
      quantity: 2,
    })) as { ok: boolean; cart: { itemCount: number; subtotalMinor: number; lines: Array<{ id: string; quantity: number }> } };
    expect(secondAdd.ok).toBe(true);
    expect(secondAdd.cart.itemCount).toBe(3);
    expect(secondAdd.cart.lines).toEqual([
      expect.objectContaining({ id: "prod_hoodie", quantity: 3 }),
    ]);
    expect(secondAdd.cart.subtotalMinor).toBe(6500 * 3);

    // Step 1: Unconfirmed proceed_to_checkout pauses at buyer_review_required without navigating, leaving totalMinor null while shipping/tax are unknown.
    const step1 = (await byName.get("proceed_to_checkout")!.execute({})) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
      totals: { subtotalMinor: number; shippingMinor: number | null; taxMinor: number | null; totalMinor: number | null };
    };
    expect(step1.ok).toBe(true);
    expect(step1.status).toBe("buyer_review_required");
    expect(step1.totals.subtotalMinor).toBe(6500 * 3);
    expect(step1.totals.shippingMinor).toBeNull();
    expect(step1.totals.taxMinor).toBeNull();
    expect(step1.totals.totalMinor).toBeNull();
    expect(navigated).toEqual([]);

    // Omitting reviewFingerprint on confirmation is rejected and stays at buyer_review_required.
    const missingFingerprintConfirm = (await byName.get("proceed_to_checkout")!.execute({
      buyerConfirmed: true,
    })) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
    };
    expect(missingFingerprintConfirm.ok).toBe(true);
    expect(missingFingerprintConfirm.status).toBe("buyer_review_required");
    expect(missingFingerprintConfirm.reviewFingerprint).toBe(step1.reviewFingerprint);
    expect(navigated).toEqual([]);

    // Mutating the cart invalidates the prior review fingerprint.
    await byName.get("add_to_cart")!.execute({ id: "prod_cap", quantity: 1 });
    const staleConfirm = (await byName.get("proceed_to_checkout")!.execute({
      buyerConfirmed: true,
      reviewFingerprint: step1.reviewFingerprint,
    })) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
    };
    expect(staleConfirm.ok).toBe(true);
    expect(staleConfirm.status).toBe("buyer_review_required");
    expect(staleConfirm.reviewFingerprint).not.toBe(step1.reviewFingerprint);
    expect(navigated).toEqual([]);

    // Step 2: Confirming the current reviewFingerprint escalates to /checkout.
    const step2 = (await byName.get("proceed_to_checkout")!.execute({
      buyerConfirmed: true,
      reviewFingerprint: staleConfirm.reviewFingerprint,
    })) as {
      ok: boolean;
      status: string;
      continueUrl: string;
    };
    expect(step2.ok).toBe(true);
    expect(step2.status).toBe("requires_escalation");
    expect(step2.continueUrl).toBe("/checkout");
    expect(navigated).toEqual(["/checkout"]);

    // Clearing the cart resets state.
    await byName.get("cancel_cart")!.execute({});
    expect(JSON.parse(storage.getItem(GUEST_CART_STORAGE_KEY) ?? "{}").lines).toEqual([]);
  });

  it("invalidates buyer review when authoritative Commerce prices change without a cart mutation", async () => {
    const storage = createMemoryStorage();
    let hoodieUnitMinor = "6500";
    const navigated: string[] = [];
    const actions = createStorefrontActions({
      storage,
      navigate: (path) => navigated.push(path),
      fetchSnapshot: async (ids) =>
        ids.map((id) => {
          if (id === "prod_hoodie") {
            return {
              ...CATALOG_FIXTURES[0]!,
              price: {
                listable: true,
                regularText: hoodieUnitMinor === "6500" ? "$65.00" : "$55.00",
                saleText: null,
                unitMinor: hoodieUnitMinor,
              },
            };
          }
          return { id, found: false as const };
        }),
    });

    await actions.updateCart({
      mode: "add",
      lines: [{ id: "prod_hoodie", quantity: 1 }],
    });

    const initialReview = await actions.proceedToCheckout();
    expect(initialReview.ok).toBe(true);
    if (!initialReview.ok) return;
    expect(initialReview.status).toBe("buyer_review_required");
    expect(initialReview.totals.subtotalMinor).toBe(6500);
    expect(initialReview.totals.totalMinor).toBeNull();

    // Commerce price changes from $65.00 (6500) to $55.00 (5500) while cart intent stays identical.
    hoodieUnitMinor = "5500";

    const confirmWithOldPriceFingerprint = await actions.proceedToCheckout({
      buyerConfirmed: true,
      reviewFingerprint: initialReview.reviewFingerprint,
    });
    expect(confirmWithOldPriceFingerprint.ok).toBe(true);
    if (!confirmWithOldPriceFingerprint.ok) return;
    expect(confirmWithOldPriceFingerprint.status).toBe("buyer_review_required");
    expect(confirmWithOldPriceFingerprint.reviewFingerprint).not.toBe(
      initialReview.reviewFingerprint,
    );
    expect(confirmWithOldPriceFingerprint.totals.subtotalMinor).toBe(5500);
    expect(navigated).toEqual([]);

    const confirmWithNewPriceFingerprint = await actions.proceedToCheckout({
      buyerConfirmed: true,
      reviewFingerprint: confirmWithOldPriceFingerprint.reviewFingerprint,
    });
    expect(confirmWithNewPriceFingerprint.ok).toBe(true);
    if (!confirmWithNewPriceFingerprint.ok) return;
    expect(confirmWithNewPriceFingerprint.status).toBe("requires_escalation");
    expect(navigated).toEqual(["/checkout"]);
  });

  it("blocks checkout escalation when the cart is empty or contains an unsellable item", async () => {
    const storage = createMemoryStorage();
    const actions = createStorefrontActions({
      storage,
      fetchSnapshot: fetchFixtureSnapshots,
    });

    const emptyProceed = await actions.proceedToCheckout({ buyerConfirmed: true });
    expect(emptyProceed.ok).toBe(false);
    if (!emptyProceed.ok) {
      expect(emptyProceed.code).toBe("EMPTY_CART");
    }

    await actions.updateCart({
      mode: "replace",
      lines: [{ id: "prod_soldout", quantity: 1 }],
    });
    const unsellableProceed = await actions.proceedToCheckout();
    expect(unsellableProceed.ok).toBe(false);
    if (!unsellableProceed.ok) {
      expect(unsellableProceed.code).toBe("UNSELLABLE_LINE");
    }
    expect(computeCartReviewFingerprint({ version: 1, lines: [] })).toBe("cart:empty");
  });
});
