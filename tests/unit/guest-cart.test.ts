import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  GUEST_CART_MAX_LINES,
  GUEST_CART_MAX_QUANTITY,
  GUEST_CART_PROCEED_LABEL,
  GUEST_CHECKOUT_REASON,
  addGuestCartLine,
  canAddCommerceProductToCart,
  emptyGuestCartIntent,
  guestCartItemCount,
  isSafeGuestCartThumbnailSrc,
  guestCartRetryControlState,
  guestReturnQueryIsPresent,
  parseGuestCartIntent,
  parseGuestCartQuantityInput,
  parseGuestCartSnapshotIds,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  presentGuestCheckoutBreakdown,
  projectGuestCartCatalogSnapshots,
  removeGuestCartLine,
  setGuestCartLineQuantity,
  stepGuestCartQuantityInput,
} from "../../src/features/guest-cart/index.js";

describe("guest cart untrusted cache", () => {
  it("accepts only version, safe IDs, and positive integer quantities", () => {
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [{ id: "11111111-1111-4111-8111-111111111111", quantity: 2 }],
      }),
    ).toEqual({
      version: 1,
      lines: [{ id: "11111111-1111-4111-8111-111111111111", quantity: 2 }],
    });
    expect(parseGuestCartIntent({ version: 2, lines: [] })).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [{ id: "safe-id", quantity: 1, price: 12 }],
      }),
    ).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [],
        payment: { status: "paid" },
      }),
    ).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [{ id: "../etc/passwd", quantity: 1 }],
      }),
    ).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [{ id: "safe-id", quantity: 1.5 }],
      }),
    ).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: [{ id: "safe-id", quantity: 0 }],
      }),
    ).toBeNull();
    expect(
      parseGuestCartIntent({
        version: 1,
        lines: Array.from({ length: GUEST_CART_MAX_LINES + 1 }, (_, index) => ({
          id: `item-${index}`,
          quantity: 1,
        })),
      }),
    ).toBeNull();
  });
});

describe("guest cart quantity mutation", () => {
  it("adds, replaces, and removes only safe positive integers", () => {
    const first = addGuestCartLine(emptyGuestCartIntent(), "hat-1", 1);
    expect(first.accepted).toBe(true);
    const increased = addGuestCartLine(first.intent, "hat-1", 2);
    expect(increased.intent.lines).toEqual([{ id: "hat-1", quantity: 3 }]);
    const set = setGuestCartLineQuantity(increased.intent, "hat-1", 8);
    expect(set.accepted).toBe(true);
    expect(set.intent.lines[0]?.quantity).toBe(8);
    expect(setGuestCartLineQuantity(set.intent, "hat-1", 0).accepted).toBe(false);
    expect(parseGuestCartQuantityInput("08")).toBeNull();
    expect(parseGuestCartQuantityInput("2")).toBe(2);
    const removed = removeGuestCartLine(set.intent, "hat-1");
    expect(removed.intent.lines).toEqual([]);
  });

  it("steps single-product and per-variant quantities within valid bounds", () => {
    expect(stepGuestCartQuantityInput("1", -1, 1)).toBe(1);
    expect(stepGuestCartQuantityInput("1", 1, 1)).toBe(2);
    expect(stepGuestCartQuantityInput("99", 1, 1)).toBe(GUEST_CART_MAX_QUANTITY);
    expect(stepGuestCartQuantityInput("invalid", 1, 1)).toBe(1);
    expect(stepGuestCartQuantityInput("invalid", -1, 1)).toBe(1);

    expect(stepGuestCartQuantityInput("0", -1, 0)).toBe(0);
    expect(stepGuestCartQuantityInput("0", 1, 0)).toBe(1);
    expect(stepGuestCartQuantityInput("2", -1, 0)).toBe(1);
    expect(stepGuestCartQuantityInput("99", 1, 0)).toBe(GUEST_CART_MAX_QUANTITY);
    expect(stepGuestCartQuantityInput("invalid", 1, 0)).toBe(1);
    expect(stepGuestCartQuantityInput("invalid", -1, 0)).toBe(0);
  });

  it("makes Add to cart a plain form whose option buttons sit in it", () => {
    const addToCartAstro = readFileSync("src/features/guest-cart/AddToCart.astro", "utf8");
    const productPageAstro = readFileSync("src/pages/products/[id].astro", "utf8");
    expect(addToCartAstro).toContain('method="post" action="/cart/add"');
    expect(addToCartAstro).toContain('name="quantity"');
    expect(addToCartAstro).toContain("data-add-to-cart-qty-step");
    expect(addToCartAstro).not.toContain("data-add-to-cart-batch");
    expect(addToCartAstro).toContain('name="productId"');
    expect(productPageAstro).toContain("<AddToCart product={cartProduct} variants={variants} productId={linkedProduct?.id} formId={addFormId} />");
    expect(productPageAstro).toContain("form={addFormId}");
    expect(productPageAstro).toContain("name={`options[${option.label}]`}");
    expect(productPageAstro).toContain("add.dataset.addToCartSellable = String(view.sellable)");
  });
});

describe("guest cart snapshot presentation", () => {
  it("keeps intent when the catalog snapshot fails and never enables checkout", () => {
    const intent = addGuestCartLine(emptyGuestCartIntent(), "hat-1", 2).intent;
    const failed = presentGuestCart({
      intent,
      snapshotFailed: true,
      storageNotice: "storage-unavailable",
    });
    expect(failed.empty).toBe(false);
    expect(failed.lines[0]).toMatchObject({
      id: "hat-1",
      quantity: 2,
      thumbnail: null,
      canCheckout: false,
    });
    expect(failed.snapshotError).toBe("We couldn't load the latest prices.");
    expect(failed.checkoutEnabled).toBe(false);
    expect(failed.checkoutLabel).toBe("Checkout unavailable");
    expect(
      presentGuestCart({
        intent,
        snapshots: [
          {
            id: "hat-1",
            found: true,
            name: "Merchant hat",
            sku: "HAT-1",
            price: { listable: false, regularText: null, saleText: null },
            availability: {
              status: "in-stock",
              sellable: true,
              listable: false,
            },
          },
        ],
      }).lines[0]?.reason,
    ).toMatch(/does not have a current price/i);
    expect(canAddCommerceProductToCart({
      price: { listable: true },
      availability: { sellable: true },
    })).toBe(true);
    expect(canAddCommerceProductToCart({
      price: { listable: true },
      availability: { sellable: false },
    })).toBe(false);
    expect(guestReturnQueryIsPresent("?success=1")).toBe(true);
    expect(parseGuestCartSnapshotIds("../etc/passwd")).toBeNull();
    expect(parseGuestCartSnapshotIds("hat-1,hat-2")).toEqual(["hat-1", "hat-2"]);
    expect(GUEST_CHECKOUT_REASON).toBe("Checkout is not available yet.");
    expect(GUEST_CHECKOUT_REASON).not.toMatch(/registry|source|artifact|stripe|provider/i);
    expect(parseGuestCartSnapshotResponse({ products: [null] })).toBeNull();
    expect(parseGuestCartSnapshotResponse({ products: [{ id: "hat-1" }] })).toBeNull();
    expect(
      projectGuestCartCatalogSnapshots([
        {
          id: "hat-1",
          found: true,
          name: "Draft hat",
          sku: "DRAFT-1",
          price: { listable: false, regularText: null, saleText: null },
          availability: {
            status: "in-stock",
            sellable: false,
            listable: false,
            displayQuantity: { value: "8", unit: "each" },
            provider: "inventory",
          },
        },
      ]),
    ).toEqual([
      {
        id: "hat-1",
        found: true,
        name: "hat-1",
        sku: "",
        fulfillment: "physical",
        thumbnail: null,
        price: { listable: false, regularText: null, saleText: null },
        availability: { status: "in-stock", sellable: false, listable: false },
      },
    ]);
    expect(
      projectGuestCartCatalogSnapshots([
        {
          id: "hat-1",
          found: true,
          name: "Merchant hat",
          sku: "HAT-1",
          price: { listable: true, regularText: "$24.00", saleText: null },
          availability: {
            status: "in-stock",
            sellable: true,
            listable: true,
            displayQuantity: { value: "8", unit: "each" },
          },
          image: { id: "media_hat", alt: "Navy hat", width: 300, height: 300, placeholder: false, src: "https://evil.example/hat.png" },
          gallery: [{ id: "media_side", alt: "Side", width: null, height: null, placeholder: false }],
        },
      ]),
    ).toEqual([
      {
        id: "hat-1",
        found: true,
        name: "Merchant hat",
        sku: "HAT-1",
        fulfillment: "physical",
        thumbnail: null,
        price: { listable: true, regularText: "$24.00", saleText: null },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
    ]);
  });

  it("computes live checkout subtotal, shipping, tax, and total breakdown", () => {
    expect(GUEST_CART_PROCEED_LABEL).toBe("Proceed to Checkout");
    const physicalIntent = addGuestCartLine(emptyGuestCartIntent(), "hat-1", 2).intent;
    const physicalSnapshot = [
      {
        id: "hat-1",
        found: true as const,
        name: "Merchant hat",
        sku: "HAT-1",
        fulfillment: "physical" as const,
        price: { listable: true, regularText: "$24.00", saleText: null, unitMinor: "2400" },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
    ];
    expect(
      presentGuestCheckoutBreakdown({
        intent: physicalIntent,
        snapshots: physicalSnapshot,
        shippingPolicy: { mode: "flat", flatRateMinor: "500" },
      }),
    ).toEqual({
      subtotalText: "$48.00",
      shippingText: "$5.00",
      taxText: "Calculated at checkout",
      totalText: "$53.00",
      subtotalMinor: "4800",
      shippingMinor: "500",
      taxMinor: "0",
      totalMinor: "5300",
      currency: "USD",
    });
    expect(
      presentGuestCheckoutBreakdown({
        intent: physicalIntent,
        snapshots: physicalSnapshot,
        shippingPolicy: { mode: "free" },
      }),
    ).toEqual({
      subtotalText: "$48.00",
      shippingText: "Free",
      taxText: "Calculated at checkout",
      totalText: "$48.00",
      subtotalMinor: "4800",
      shippingMinor: "0",
      taxMinor: "0",
      totalMinor: "4800",
      currency: "USD",
    });
    expect(
      presentGuestCheckoutBreakdown({
        intent: physicalIntent,
        snapshots: physicalSnapshot,
        shippingPolicy: null,
      }),
    ).toEqual({
      subtotalText: "$48.00",
      shippingText: "Calculated at checkout",
      taxText: "Calculated at checkout",
      totalText: "Calculated at checkout",
      subtotalMinor: "4800",
      shippingMinor: null,
      taxMinor: "0",
      totalMinor: null,
      currency: "USD",
    });

    const digitalIntent = addGuestCartLine(emptyGuestCartIntent(), "guide-1", 1).intent;
    const digitalSnapshot = [
      {
        id: "guide-1",
        found: true as const,
        name: "Digital Guide",
        sku: "GUIDE-1",
        fulfillment: "digital" as const,
        price: { listable: true, regularText: "$12.00", saleText: null, unitMinor: "1200" },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
    ];
    expect(
      presentGuestCheckoutBreakdown({
        intent: digitalIntent,
        snapshots: digitalSnapshot,
        shippingPolicy: { mode: "flat", flatRateMinor: "500" },
      }),
    ).toEqual({
      subtotalText: "$12.00",
      shippingText: "Free",
      taxText: "Calculated at checkout",
      totalText: "$12.00",
      subtotalMinor: "1200",
      shippingMinor: "0",
      taxMinor: "0",
      totalMinor: "1200",
      currency: "USD",
    });
  });
});

describe("guest cart thumbnails", () => {
  const listed = (thumbnail: unknown, listable = true) => ({
    id: "hoodie-olive-m",
    found: true,
    name: "Pullover Hoodie",
    sku: "HOODIE-M",
    thumbnail,
    price: { listable, regularText: listable ? "$60.00" : null, saleText: null, unitMinor: listable ? "6000" : null },
    availability: { status: "in-stock", sellable: listable, listable },
  });

  it("accepts the Commerce image resolver's public URL shapes", () => {
    expect(isSafeGuestCartThumbnailSrc("/_emdash/api/media/file/media-hoodie.png")).toBe(true);
    expect(isSafeGuestCartThumbnailSrc("https://media.example.test/main.jpg")).toBe(true);
    expect(isSafeGuestCartThumbnailSrc("http://media.example.test/main.jpg")).toBe(true);
  });

  it("rejects unsafe thumbnail URLs", () => {
    for (const src of [
      "",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "//evil.example/x.png",
      "/_emdash/api/media/file/../secret.png",
      "/_emdash/api/media/file/%2e%2e/secret.png",
      "/media\\x.png",
      "https://reviewer@media.example.test/x.png",
      "ftp://media.example.test/x.png",
      "/a b.png",
      `/${"a".repeat(2050)}`,
    ]) {
      expect(isSafeGuestCartThumbnailSrc(src), src).toBe(false);
    }
  });

  it("carries a runtime-approved HTTPS media URL from snapshot to cart line", () => {
    const snapshots = projectGuestCartCatalogSnapshots([
      listed({ src: "https://media.example.test/main.jpg", alt: "Olive pullover hoodie" }),
    ]);
    expect(snapshots?.[0]).toMatchObject({
      thumbnail: { src: "https://media.example.test/main.jpg", alt: "Olive pullover hoodie" },
    });
    const view = presentGuestCart({
      intent: addGuestCartLine(emptyGuestCartIntent(), "hoodie-olive-m", 1).intent,
      snapshots,
    });
    expect(view.lines[0]?.thumbnail).toEqual({ src: "https://media.example.test/main.jpg", alt: "Olive pullover hoodie" });
  });

  it("uses the product name as alt text when media alt is blank", () => {
    const snapshots = projectGuestCartCatalogSnapshots([listed({ src: "/_emdash/api/media/file/m.png", alt: " " })]);
    expect(snapshots?.[0]).toMatchObject({ thumbnail: { src: "/_emdash/api/media/file/m.png", alt: "Pullover Hoodie" } });
  });

  it("never guesses artwork: missing, unsafe, or unlisted media yields the neutral placeholder", () => {
    for (const candidate of [undefined, null, {}, { src: "javascript:alert(1)", alt: "x" }]) {
      expect(projectGuestCartCatalogSnapshots([listed(candidate)])?.[0]).toMatchObject({ thumbnail: null });
    }
    expect(
      projectGuestCartCatalogSnapshots([listed({ src: "https://media.example.test/main.jpg", alt: "x" }, false)])?.[0],
    ).toMatchObject({ name: "hoodie-olive-m", thumbnail: null });
    const missing = presentGuestCart({
      intent: addGuestCartLine(emptyGuestCartIntent(), "hoodie-olive-m", 1).intent,
      snapshots: [{ id: "hoodie-olive-m", found: false }],
    });
    expect(missing.lines[0]?.thumbnail).toBeNull();
  });
});

describe("guest cart retry control", () => {
  const intent = addGuestCartLine(emptyGuestCartIntent(), "hat-1", 1).intent;

  it("stays hidden when there is no snapshot error", () => {
    const ok = presentGuestCart({ intent, snapshots: [] });
    expect(ok.snapshotError).toBeNull();
    expect(guestCartRetryControlState(ok).hidden).toBe(true);
    const loading = presentGuestCart({ intent, pending: true });
    expect(guestCartRetryControlState(loading)).toEqual({ hidden: true, disabled: true });
  });

  it("is visible and enabled after a snapshot error", () => {
    const failed = presentGuestCart({ intent, snapshotFailed: true });
    expect(failed.snapshotError).toBe("We couldn't load the latest prices.");
    expect(guestCartRetryControlState(failed)).toEqual({ hidden: false, disabled: false });
  });

  it("is disabled while a refresh is pending", () => {
    const failed = presentGuestCart({ intent, snapshotFailed: true });
    expect(guestCartRetryControlState({ ...failed, pending: true })).toEqual({ hidden: false, disabled: true });
  });

  it("stays visible and disabled while pending after an error", () => {
    const pendingRetry = presentGuestCart({ intent, pending: true, retrying: true });
    expect(pendingRetry.snapshotError).toBeNull();
    expect(guestCartRetryControlState(pendingRetry)).toEqual({ hidden: false, disabled: true });
    expect(guestCartRetryControlState({ snapshotError: null, pending: true, retrying: true })).toEqual({
      hidden: false,
      disabled: true,
    });
    expect(guestCartRetryControlState({ snapshotError: null, pending: true, retryPending: true })).toEqual({
      hidden: false,
      disabled: true,
    });
  });

  it("hides once a refresh succeeds", () => {
    const success = presentGuestCart({ intent, snapshots: [] });
    expect(success.snapshotError).toBeNull();
    expect(guestCartRetryControlState(success)).toEqual({ hidden: true, disabled: false });
  });

  it("stays visible and becomes enabled when retry fails again", () => {
    const failedAgain = presentGuestCart({ intent, snapshotFailed: true, retrying: false });
    expect(failedAgain.snapshotError).toBe("We couldn't load the latest prices.");
    expect(guestCartRetryControlState(failedAgain)).toEqual({ hidden: false, disabled: false });
  });
});
