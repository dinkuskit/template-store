import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  GUEST_CART_MAX_LINES,
  GUEST_CART_MAX_QUANTITY,
  GUEST_CART_MAX_RAW_LENGTH,
  GUEST_CART_PROCEED_LABEL,
  GUEST_CART_STORAGE_KEY,
  GUEST_CHECKOUT_REASON,
  addGuestCartLine,
  canAddCommerceProductToCart,
  emptyGuestCartIntent,
  guestCartItemCount,
  isSafeGuestCartThumbnailSrc,
  guestCartRetryControlState,
  guestReturnQueryIsPresent,
  loadGuestCartIntent,
  parseGuestCartIntent,
  parseGuestCartQuantityInput,
  parseGuestCartSnapshotIds,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  presentGuestCheckoutBreakdown,
  projectGuestCartCatalogSnapshots,
  removeGuestCartLine,
  saveGuestCartIntent,
  setGuestCartLineQuantity,
  stepGuestCartQuantityInput,
} from "../../src/features/guest-cart/index.js";
import { hydrateGuestCartControls } from "../../src/features/guest-cart/guest-cart-client.js";

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

  it("wires the PDP quantity stepper and one Add to cart that refuses an unavailable variant", () => {
    const addToCartAstro = readFileSync("src/features/guest-cart/AddToCart.astro", "utf8");
    const productPageAstro = readFileSync("src/pages/products/[id].astro", "utf8");
    expect(addToCartAstro).toContain("data-add-to-cart-qty");
    expect(addToCartAstro).toContain("data-add-to-cart-qty-step");
    // One Add to cart per product page: no second per-option quantity block.
    expect(addToCartAstro).not.toContain("data-add-to-cart-batch");
    expect(addToCartAstro).not.toContain("data-variant-qty");
    expect(addToCartAstro).toContain(".guest-cart-add :global([hidden]){display:none}");
    expect(addToCartAstro).toContain(".guest-cart-add__single:not([hidden]){display:flex");
    expect(addToCartAstro).toContain("data-add-to-cart-sellable");
    expect(productPageAstro).toContain("<AddToCart product={cartProduct} variants={variants} />");
    expect(productPageAstro).toContain("add.dataset.addToCartSellable = String(view.sellable)");
    expect(productPageAstro).toContain("data-variant-option={option.label}");

    class MockElement {
      dataset: Record<string, string> = {};
      hidden = false;
      textContent = "";
      parentElement: MockElement | null = null;
      private attrs = new Map<string, string>();
      private listeners = new Map<string, (() => void)[]>();
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      }
      getAttribute(name: string) {
        return this.attrs.get(name) ?? null;
      }
      addEventListener(type: string, cb: () => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }
      click() {
        for (const cb of this.listeners.get("click") ?? []) cb();
      }
      closest(selector: string): MockElement | null {
        let cur: MockElement | null = this;
        while (cur) {
          if (selector === ".guest-cart-add" && cur.getAttribute("data-mock-role") === "container") return cur;
          if (selector === "[data-add-to-cart-single]" && cur.getAttribute("data-mock-role") === "single") return cur;
          if (selector === "[hidden]" && cur.hidden) return cur;
          cur = cur.parentElement;
        }
        return null;
      }
      querySelector(_selector: string): MockElement | null {
        return null;
      }
      querySelectorAll(_selector: string): MockElement[] {
        return [];
      }
    }
    class MockInput extends MockElement {
      disabled = false;
      constructor(public value: string) {
        super();
      }
    }
    class MockButton extends MockElement {
      disabled = false;
    }

    const store = memoryStorage();
    const qtyInput = new MockInput("1");
    const stepUp = new MockButton();
    stepUp.setAttribute("data-add-to-cart-qty-step", "1");
    const stepDown = new MockButton();
    stepDown.setAttribute("data-add-to-cart-qty-step", "-1");
    const addButton = new MockButton();
    addButton.setAttribute("data-add-to-cart", "hoodie-small-indigo");
    addButton.setAttribute("data-add-to-cart-sellable", "true");
    const status = new MockElement();
    status.hidden = true;
    const navBadge = new MockElement();
    const navLink = new MockElement();
    navLink.querySelector = (sel: string) => (sel === "[data-guest-cart-count]" ? navBadge : null);

    const container = new MockElement();
    container.setAttribute("data-mock-role", "container");
    const singleWrapper = new MockElement();
    singleWrapper.setAttribute("data-mock-role", "single");
    singleWrapper.parentElement = container;
    for (const child of [qtyInput, stepUp, stepDown, addButton]) {
      child.parentElement = singleWrapper;
    }
    status.parentElement = container;
    container.querySelector = (selector: string) => {
      if (selector === "[data-add-to-cart-qty]") return qtyInput;
      if (selector === "[data-add-to-cart-status]") return status;
      return null;
    };

    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("HTMLElement", MockElement);
    vi.stubGlobal("HTMLInputElement", MockInput);
    vi.stubGlobal("HTMLButtonElement", MockButton);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("document", {
      querySelectorAll(selector: string) {
        if (selector === "[data-guest-cart-nav]") return [navLink];
        if (selector === "[data-add-to-cart-qty-step]") return [stepUp, stepDown];
        if (selector === "[data-add-to-cart]") return [addButton];
        return [];
      },
      dispatchEvent() {
        return true;
      },
    });

    try {
      hydrateGuestCartControls();
      // Step single quantity to 3 and click Add to cart
      stepUp.click();
      stepUp.click();
      expect(qtyInput.value).toBe("3");
      addButton.click();
      expect(status.textContent).toBe("Added to cart.");
      expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, store).intent.lines).toEqual([
        { id: "hoodie-small-indigo", quantity: 3 },
      ]);

      // Reject invalid single quantity
      qtyInput.value = "0";
      addButton.click();
      expect(status.textContent).toBe("Quantity must be a whole number from 1 to 99.");
      expect(status.getAttribute("role")).toBe("alert");
      qtyInput.value = "1";

      // Picking another variant points the one Add to cart at it
      addButton.setAttribute("data-add-to-cart", "hoodie-xl-vermilion");
      qtyInput.value = "3";
      addButton.click();
      expect(status.textContent).toBe("Added to cart.");
      expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, store).intent.lines).toEqual([
        { id: "hoodie-small-indigo", quantity: 3 },
        { id: "hoodie-xl-vermilion", quantity: 3 },
      ]);

      // Selecting an unavailable variant marks addButton unsellable and disables it;
      // clicking addButton must refuse to add the unavailable variant.
      addButton.setAttribute("data-add-to-cart", "hoodie-medium-indigo");
      addButton.setAttribute("data-add-to-cart-sellable", "false");
      addButton.disabled = true;
      status.textContent = "";
      addButton.click();
      expect(status.textContent).toBe("");
      expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, store).intent.lines).toEqual([
        { id: "hoodie-small-indigo", quantity: 3 },
        { id: "hoodie-xl-vermilion", quantity: 3 },
      ]);

      // Even if someone removes disabled, sellable="false" still blocks single-add
      addButton.disabled = false;
      addButton.click();
      expect(loadGuestCartIntent(GUEST_CART_STORAGE_KEY, store).intent.lines).toEqual([
        { id: "hoodie-small-indigo", quantity: 3 },
        { id: "hoodie-xl-vermilion", quantity: 3 },
      ]);

      expect(navBadge.textContent).toBe("6");
    } finally {
      vi.unstubAllGlobals();
    }
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
