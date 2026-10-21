import { describe, expect, it } from "vitest";
import { isPlaygroundPreviewHost } from "../../src/features/shopper-account/playground-runtime.js";

describe("Playground PR preview account notice", () => {
  const playground = "https://playground.dinkuskit.com";

  it("is shown on a PR preview subdomain of the Playground", () => {
    expect(isPlaygroundPreviewHost(new URL("https://pr-117.playground.dinkuskit.com/account"), playground)).toBe(true);
  });

  it("is not shown on the Playground itself or an unrelated host", () => {
    expect(isPlaygroundPreviewHost(new URL("https://playground.dinkuskit.com/account"), playground)).toBe(false);
    expect(isPlaygroundPreviewHost(new URL("http://127.0.0.1:4637/account"), playground)).toBe(false);
    expect(isPlaygroundPreviewHost(new URL("https://evilplayground.dinkuskit.com/account"), playground)).toBe(false);
  });
});
