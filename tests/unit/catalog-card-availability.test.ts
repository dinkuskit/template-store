import { describe, expect, it, vi } from "vitest";
import type { PublicCommerceProduct, PublicCommerceVariant } from "../../src/features/commerce-catalog/types.js";

vi.mock("emdash", () => ({ handleMediaGet: vi.fn() }));
vi.mock("emdash/runtime", () => ({ getDb: vi.fn() }));
import { catalogCardAvailability } from "../../src/features/commerce-catalog/index.js";

const availability = (status: PublicCommerceProduct["availability"]["status"]) => ({
  status, sellable: status === "in-stock" || status === "available-on-backorder", listable: true,
});
const member = (id: string, status: PublicCommerceVariant["availability"]["status"]): PublicCommerceVariant => ({
  id, selections: [["Size", id]], unitMinor: "3400", priceText: "$34.00", availability: availability(status),
});

describe("catalog card availability without a selected option", () => {
  it.each([
    ["in-stock", "In stock"], ["low-stock", "Low stock"], ["out-of-stock", "Out of stock"],
    ["available-on-backorder", "Available on backorder"], ["availability-unavailable", "Availability unavailable"],
  ] as const)("keeps a simple product's %s fact", (status, label) => {
    for (const variants of [undefined, []]) {
      expect(catalogCardAvailability({ availability: availability(status), variants })).toEqual({ status, label });
    }
  });

  it.each([
    ["out-of-stock", "in-stock"], ["in-stock", "out-of-stock"],
    ["out-of-stock", "out-of-stock"], ["availability-unavailable", "available-on-backorder"],
  ] as const)("does not promote default %s to family stock when another option is %s", (status, otherStatus) => {
    const product = { availability: { ...availability(status), sellable: false },
      variants: [member("M", status), member("L", otherStatus)] };
    const before = structuredClone(product);
    expect(catalogCardAvailability(product)).toEqual({ status: "options", label: "Check options" });
    expect(product).toEqual(before);
  });
});
