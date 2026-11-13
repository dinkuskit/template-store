import { describe, expect, it, vi } from "vitest";
import type { PublicCommerceProduct, PublicCommerceVariant } from "../../src/features/commerce-catalog/types.js";

vi.mock("emdash", () => ({ handleMediaGet: vi.fn() }));
vi.mock("emdash/runtime", () => ({ getDb: vi.fn() }));
import { catalogCardAvailability } from "../../src/features/commerce-catalog/index.js";

const availability = (status: PublicCommerceProduct["availability"]["status"]) => ({
  status, sellable: ["in-stock", "low-stock", "available-on-backorder"].includes(status), listable: true,
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
    ["out-of-stock", "in-stock", "in-stock", "In stock"],
    ["in-stock", "in-stock", "in-stock", "In stock"],
    ["in-stock", "low-stock", "in-stock", "In stock"],
    ["low-stock", "available-on-backorder", "low-stock", "Low stock"],
    ["out-of-stock", "available-on-backorder", "available-on-backorder", "Available on backorder"],
    ["out-of-stock", "out-of-stock", "out-of-stock", "Out of stock"],
    ["availability-unavailable", "out-of-stock", "out-of-stock", "Out of stock"],
    ["availability-unavailable", "availability-unavailable", "availability-unavailable", "Availability unavailable"],
  ] as const)("summarizes %s / %s as %s regardless of member order", (status, otherStatus, expected, label) => {
    const variants = [member("M", status), member("L", otherStatus)];
    const before = structuredClone(variants);
    for (const ordered of [variants, [...variants].reverse()]) {
      expect(catalogCardAvailability({ availability: availability("out-of-stock"), variants: ordered }))
        .toEqual({ status: expected, label });
    }
    expect(variants).toEqual(before);
  });

  it("does not promote an in-stock member that Commerce refuses to sell", () => {
    const refused = { ...member("M", "in-stock"), availability: { status: "in-stock" as const, sellable: false } };
    expect(catalogCardAvailability({ availability: availability("in-stock"), variants: [refused, member("L", "low-stock")] }))
      .toEqual({ status: "low-stock", label: "Low stock" });
    expect(catalogCardAvailability({ availability: availability("in-stock"), variants: [refused] }))
      .toEqual({ status: "out-of-stock", label: "Out of stock" });
  });
});
