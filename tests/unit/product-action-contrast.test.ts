import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

function luminance(hex: string): number {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi)!.map(pair => Number.parseInt(pair, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test("default action text clears WCAG normal-text contrast in both themes", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const colors = (name: string) => tokens.match(new RegExp(`--${name}: light-dark\\((#[a-f\\d]{6}), (#[a-f\\d]{6})\\)`))!.slice(1);
  const backgrounds = colors("dinkus-action-background");
  const foregrounds = colors("dinkus-action-color");
  for (let mode = 0; mode < 2; mode++) {
    const pair = [luminance(backgrounds[mode]!), luminance(foregrounds[mode]!)].sort((a, b) => b - a);
    expect((pair[0]! + 0.05) / (pair[1]! + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
