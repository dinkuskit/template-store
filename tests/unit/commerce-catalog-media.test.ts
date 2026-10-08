import { describe, expect, it } from "vitest";
import {
  COMMERCE_IMAGE_SIZES,
  commerceImageSrcset,
  resolveCommerceImage,
} from "../../src/features/commerce-catalog/media.js";

const image = {
  id: "media_hat",
  alt: "Navy hat on a table",
  width: 400,
  height: 300,
  placeholder: false,
};

describe("commerce catalog image presentation", () => {
  it("builds the EmDash srcset from the public file URL and keeps the projected alt", async () => {
    const resolved = await resolveCommerceImage(image, {
      origin: "https://shop.example.test",
      async getMedia() {
        return { mimeType: "image/png", storageKey: "01HAT.png", status: "ready" };
      },
      getPublicMediaUrl: (key) => `/_emdash/api/media/file/${key}`,
    });
    expect(resolved).toMatchObject({
      alt: "Navy hat on a table",
      placeholder: false,
      src: "/_emdash/api/media/file/01HAT.png",
      sizes: COMMERCE_IMAGE_SIZES,
    });
    expect(resolved!.srcset).toBe(
      "/_image?href=https%3A%2F%2Fshop.example.test%2F_emdash%2Fapi%2Fmedia%2Ffile%2F01HAT.png&w=300&f=webp 300w",
    );
    expect(resolved!.srcset).not.toContain("w=600");
    expect(commerceImageSrcset("/photos/hat.png", null, "https://shop.example.test")).toContain("w=1200");
  });

  it("uses a placeholder instead of an unsafe or unreadable file", async () => {
    const resolver = {
      origin: "https://shop.example.test",
      getPublicMediaUrl: (key: string) => key,
    };
    await expect(resolveCommerceImage(image, {
      ...resolver,
      async getMedia() {
        return { mimeType: "image/png", storageKey: "../secret", status: "ready" };
      },
    })).resolves.toBeNull();
    await expect(resolveCommerceImage(image, {
      ...resolver,
      async getMedia() {
        return { mimeType: "application/pdf", storageKey: "01HAT.pdf", status: "ready" };
      },
    })).resolves.toBeNull();
    await expect(resolveCommerceImage(image, {
      ...resolver,
      getPublicMediaUrl: () => "javascript:alert(1)",
      async getMedia() {
        return { mimeType: "image/jpeg", storageKey: "01HAT.jpg", status: "ready" };
      },
    })).resolves.toBeNull();
    await expect(resolveCommerceImage(null, {
      ...resolver,
      async getMedia() {
        throw new Error("should not read");
      },
    })).resolves.toBeNull();
  });
});
