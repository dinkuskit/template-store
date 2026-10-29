import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCheckoutContact } from "../../src/features/guest-cart/guest-cart-client.js";

class ContactInput {
  constructor(public value: string, public checked = false) {}
}

class ContactSelect extends ContactInput {}

const delivered = {
  name: "Test shopper",
  line1: "1 Example Way",
  city: "New York",
  region: "NY",
  postalCode: "10001",
  country: "US",
};

/** Delivery fields by name, billing fields as `billing-<name>`, and the "same as delivery" box. */
function contactForm(fields: Record<string, string> = {}, same = true): Element {
  const values: Record<string, string> = {
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
      if (selector === "[data-guest-cart-billing-same]") return new ContactInput("on", same);
      const field = selector === "[data-guest-cart-email]"
        ? "email"
        : selector.replace("[data-guest-cart-delivery-", "").replace("[data-guest-cart-", "").replace("]", "");
      const value = values[field] ?? "";
      return field.endsWith("country") ? new ContactSelect(value) : new ContactInput(value);
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
      contact: { email: "shopper@example.test", delivery: delivered, billing: delivered },
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

  it("does not read or send stale delivery fields for digital-only checkout, and asks for billing", () => {
    const billing = { "billing-name": "Bill Payer", "billing-line1": "9 Billing Way", "billing-city": "Toronto", "billing-postal-code": "M5V 1A1", "billing-country": "ca" };
    const form = (values: Record<string, string>) => ({
      querySelector(selector: string) {
        if (selector.startsWith("[data-guest-cart-delivery-")) throw new Error("Delivery fields must not be read");
        if (selector === "[data-guest-cart-billing-same]") return new ContactInput("on", true);
        const field = selector === "[data-guest-cart-email]" ? "email" : selector.replace("[data-guest-cart-", "").replace("]", "");
        return new ContactInput(({ email: "shopper@example.test", ...values } as Record<string, string>)[field] ?? "");
      },
    }) as unknown as Element;
    // The box only applies to a delivery address, which a digital-only cart never has.
    expect(readCheckoutContact(form(billing), false)).toEqual({
      contact: { email: "shopper@example.test", billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Toronto", postalCode: "M5V 1A1", country: "CA" } },
      error: null,
    });
    expect(readCheckoutContact(form({}), false)).toEqual({
      contact: null,
      error: "Complete the billing name, address, city, postal code, and country fields.",
    });
  });

  it("sends a different billing address when the box is unticked, and refuses an incomplete one", () => {
    const billing = { "billing-name": "Bill Payer", "billing-line1": "9 Billing Way", "billing-city": "Toronto", "billing-region": "ON", "billing-postal-code": "M5V 1A1", "billing-country": "CA" };
    expect(readCheckoutContact(contactForm({ region: "NY", ...billing }, false), true)).toEqual({
      contact: { email: "shopper@example.test", delivery: delivered,
        billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Toronto", region: "ON", postalCode: "M5V 1A1", country: "CA" } },
      error: null,
    });
    expect(readCheckoutContact(contactForm({ region: "NY", ...billing, "billing-city": "" }, false), true).error)
      .toBe("Complete the billing name, address, city, postal code, and country fields.");
  });

  it("leaves an empty delivery address for Commerce to refuse rather than sending an empty billing copy", () => {
    expect(readCheckoutContact(contactForm({ name: "", line1: "", city: "", "postal-code": "", country: "" }), true)).toEqual({
      contact: { email: "shopper@example.test" },
      error: null,
    });
  });
});
