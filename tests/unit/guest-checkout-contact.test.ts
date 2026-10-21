import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCheckoutContact } from "../../src/features/guest-cart/guest-cart-client.js";

class ContactInput {
  constructor(public value: string) {}
}

class ContactSelect extends ContactInput {}

function contactForm(fields: Record<string, string> = {}): Element {
  const values = {
    email: "shopper@example.test",
    name: "Test shopper",
    line1: "1 Example Way",
    city: "New York",
    "postal-code": "10001",
    country: "US",
    ...fields,
  };
  return {
    querySelector(selector: string) {
      const field = selector === "[data-guest-cart-email]"
        ? "email"
        : selector.replace("[data-guest-cart-delivery-", "").replace("]", "");
      const value = values[field as keyof typeof values] ?? "";
      return field === "country" ? new ContactSelect(value) : new ContactInput(value);
    },
  } as unknown as Element;
}

describe("guest checkout delivery contact", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLInputElement", ContactInput);
    vi.stubGlobal("HTMLSelectElement", ContactSelect);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(["", "   "])("refuses a US physical address with blank region %j", (region) => {
    expect(readCheckoutContact(contactForm({ region, country: "us" }), true)).toEqual({
      contact: null,
      error: "Enter a state for United States delivery.",
    });
  });

  it("forwards a filled US region without taking over Commerce's geographic validation", () => {
    expect(readCheckoutContact(contactForm({ region: " NY " }), true)).toEqual({
      contact: {
        email: "shopper@example.test",
        delivery: {
          name: "Test shopper",
          line1: "1 Example Way",
          city: "New York",
          region: "NY",
          postalCode: "10001",
          country: "US",
        },
      },
      error: null,
    });
  });

  it("keeps region optional for a non-US contact without adding a storefront destination", () => {
    const result = readCheckoutContact(contactForm({ country: "ca" }), true);
    expect(result.error).toBeNull();
    expect(result.contact?.delivery).toEqual({
      name: "Test shopper",
      line1: "1 Example Way",
      city: "New York",
      postalCode: "10001",
      country: "CA",
    });
    expect(result.contact?.delivery).not.toHaveProperty("region");
  });

  it("does not read or send stale delivery fields for digital-only checkout", () => {
    const form = {
      querySelector(selector: string) {
        if (selector !== "[data-guest-cart-email]") throw new Error("Delivery fields must not be read");
        return new ContactInput("shopper@example.test");
      },
    } as unknown as Element;
    expect(readCheckoutContact(form, false)).toEqual({
      contact: { email: "shopper@example.test" },
      error: null,
    });
  });
});
