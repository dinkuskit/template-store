import { describe, expect, it } from "vitest";

import {
  GUEST_CART_MAX_LINES,
  GUEST_CART_MAX_RAW_LENGTH,
  GUEST_CART_STORAGE_KEY,
  GUEST_CHECKOUT_REASON,
  addGuestCartLine,
  canAddCommerceProductToCart,
  emptyGuestCartIntent,
  guestCartFallbackThumbnail,
  guestCartItemCount,
  guestCartRetryControlState,
  guestReturnQueryIsPresent,
  isSafeGuestCartThumbnailSrc,
  loadGuestCartIntent,
  parseGuestCartIntent,
  parseGuestCartQuantityInput,
  parseGuestCartSnapshotIds,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  projectGuestCartCatalogSnapshots,
  removeGuestCartLine,
  saveGuestCartIntent,
  setGuestCartLineQuantity,
} from "../../src/features/guest-cart/index.js";

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

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

  it("rejects malformed storage without crashing and keeps an in-session cart", () => {
    expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, null)).toMatchObject({
      intent: emptyGuestCartIntent(),
      persisted: false,
      notice: "storage-unavailable",
    });
    expect(
      loadGuestCartIntent(GUEST_CART_STORAGE_KEY, memoryStorage({
        [GUEST_CART_STORAGE_KEY]: "{not-json",
      })),
    ).toMatchObject({
      intent: emptyGuestCartIntent(),
      notice: "rejected-malformed",
    });
    const brokenWrite = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("quota");
      },
    };
    const added = addGuestCartLine(emptyGuestCartIntent(), "hat-1", 2);
    expect(added.accepted).toBe(true);
    expect(saveGuestCartIntent(GUEST_CART_STORAGE_KEY, added.intent, brokenWrite)).toMatchObject({
      intent: added.intent,
      persisted: false,
      notice: "storage-write-failed",
    });
    expect(guestCartItemCount(added.intent)).toBe(2);
    const original = memoryStorage({
      [GUEST_CART_STORAGE_KEY]: JSON.stringify({
        version: 1,
        lines: [{ id: "hat-1", quantity: 2 }],
      }),
    });
    const failedWrite = {
      getItem(key: string) {
        return original.getItem(key);
      },
      setItem() {
        throw new Error("quota");
      },
    };
    const next = setGuestCartLineQuantity(
      { version: 1, lines: [{ id: "hat-1", quantity: 2 }] },
      "hat-1",
      4,
    );
    expect(saveGuestCartIntent(GUEST_CART_STORAGE_KEY, next.intent, failedWrite).persisted).toBe(false);
    expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, original).intent.lines).toEqual([
      { id: "hat-1", quantity: 2 },
    ]);
    expect(
      loadGuestCartIntent(
        GUEST_CART_STORAGE_KEY,
        memoryStorage({ [GUEST_CART_STORAGE_KEY]: "x".repeat(GUEST_CART_MAX_RAW_LENGTH + 1) }),
      ),
    ).toMatchObject({
      intent: emptyGuestCartIntent(),
      notice: "rejected-malformed",
    });
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
      thumbnail: {
        src: "/merch/cap.svg",
        alt: "hat-1 illustration",
      },
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
        thumbnail: {
          src: "/merch/cap.svg",
          alt: "hat-1 illustration",
        },
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
        thumbnail: {
          src: "/merch/cap.svg",
          alt: "Merchant hat illustration",
        },
        price: { listable: true, regularText: "$24.00", saleText: null },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
    ]);
  });

  it("projects safe product/variant thumbnails and falls back to garment illustrations", () => {
    expect(isSafeGuestCartThumbnailSrc("/merch/hoodie.svg")).toBe(true);
    expect(isSafeGuestCartThumbnailSrc("/images/products/hoodie.svg")).toBe(true);
    expect(isSafeGuestCartThumbnailSrc("/_emdash/api/media/file/media-hoodie-olive.png")).toBe(true);
    expect(
      isSafeGuestCartThumbnailSrc(
        "/_image?href=%2F_emdash%2Fapi%2Fmedia%2Ffile%2Fmedia-hoodie-olive.png&w=640&f=webp",
      ),
    ).toBe(true);
    expect(isSafeGuestCartThumbnailSrc("https://evil.example/hoodie.png")).toBe(false);
    expect(isSafeGuestCartThumbnailSrc("/_emdash/api/media/file/../secret.png")).toBe(false);

    expect(guestCartFallbackThumbnail("Pullover Hoodie (Medium)", "DEMO-HOSTED-HOODIE-M", "hoodie-m")).toEqual({
      src: "/merch/hoodie.svg",
      alt: "Pullover Hoodie (Medium) illustration",
    });
    expect(guestCartFallbackThumbnail("Ribbed Beanie", "BEAN-1", "bean-1")).toEqual({
      src: "/merch/beanie.svg",
      alt: "Ribbed Beanie illustration",
    });
    expect(guestCartFallbackThumbnail("Everyday Tee", "TEE-1", "tee-1")).toEqual({
      src: "/merch/tee.svg",
      alt: "Everyday Tee illustration",
    });

    const snapshots = projectGuestCartCatalogSnapshots([
      {
        id: "hoodie-olive-m",
        found: true,
        name: "Pullover Hoodie — Olive / M",
        sku: "DEMO-HOSTED-HOODIE-M",
        thumbnail: {
          src: "/_emdash/api/media/file/media-hoodie-olive.png",
          alt: "Olive pullover hoodie",
        },
        price: { listable: true, regularText: "$60.00", saleText: null, unitMinor: "6000" },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
    ]);
    expect(snapshots?.[0]).toMatchObject({
      id: "hoodie-olive-m",
      found: true,
      thumbnail: {
        src: "/_emdash/api/media/file/media-hoodie-olive.png",
        alt: "Olive pullover hoodie",
      },
    });
    const view = presentGuestCart({
      intent: addGuestCartLine(emptyGuestCartIntent(), "hoodie-olive-m", 1).intent,
      snapshots,
    });
    expect(view.lines[0]?.thumbnail).toEqual({
      src: "/_emdash/api/media/file/media-hoodie-olive.png",
      alt: "Olive pullover hoodie",
    });
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
  });
});
