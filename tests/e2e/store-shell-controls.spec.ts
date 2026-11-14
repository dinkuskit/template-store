import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator } from "@playwright/test";

// Sample actual painted text, including transparent input backgrounds. These
// controls have no gradients/overlays between their text and opaque surface.
async function controlSamples(controls: Locator) {
  return controls.evaluateAll(elements => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const over = (top: number[], bottom: number[]) => top.slice(0, 3).map((v, i) => v * top[3] / 255 + bottom[i]! * (1 - top[3] / 255));
    const luminance = (rgb: number[]) => rgb.map(v => {
      const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    return elements.filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden").map(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      const layers: number[][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
      let paper = [255, 255, 255];
      for (const layer of layers.reverse()) paper = over(layer, paper);
      const ink = luminance(over(rgba(style.color), paper)), background = luminance(paper);
      return { label: el.getAttribute("aria-label") || el.textContent?.trim(), width: rect.width, height: rect.height, contrast: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) };
    });
  });
}

for (const preset of ["aizome", "forest", "cobalt"]) for (const theme of ["light", "dark", ...(preset === "aizome" ? ["system"] : [])]) {
  test(`shell search and switchers are readable and targetable (${preset}, ${theme})`, async ({ page, context, baseURL }, testInfo) => {
    let writes = 0;
    await context.route("**/*", route => {
      if (!["GET", "HEAD"].includes(route.request().method())) { writes++; return route.abort(); }
      return route.continue();
    });
    await context.addCookies([
      { name: "dinkus_preset", value: preset, url: baseURL! },
      { name: "dinkus_theme", value: theme, url: baseURL! },
    ]);
    if (theme === "system") await page.emulateMedia({ colorScheme: "dark" });
    expect((await page.goto("/cart"))?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-preset", preset);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const controls = page.locator(".store-header__search-input, .store-header__search-go, .widget-search__input, .widget-search__button, .store-switcher-pill, .store-main-nav__expand");
    const samples = await controlSamples(controls);
    // Exercise default, hover, keyboard-focus and pressed states on the actual
    // shell controls; also retain typed query text while changing appearance.
    const footerInput = page.locator(".store-footer .widget-search__input");
    await footerInput.fill("Everyday");
    await footerInput.focus();
    await expect(footerInput).toBeFocused();
    const focus = await footerInput.evaluate(el => { const style = getComputedStyle(el); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
    await page.keyboard.press("Tab");
    const footerButton = page.locator(".store-footer .widget-search__button");
    await expect(footerButton).toBeFocused();
    await footerButton.hover();
    samples.push(...await controlSamples(controls));
    const otherTheme = theme === "light" ? "dark" : "light";
    await page.locator(`[data-theme-choice="${otherTheme}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", otherTheme);
    const choice = page.locator(`[data-theme-choice="${theme}"]`);
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    const otherPreset = preset === "aizome" ? "forest" : "aizome";
    await page.locator(`[data-preset-choice="${otherPreset}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-preset", otherPreset);
    const presetChoice = page.locator(`[data-preset-choice="${preset}"]`);
    await presetChoice.click();
    await expect(presetChoice).toHaveAttribute("aria-pressed", "true");
    await expect(footerInput).toHaveValue("Everyday");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-preset", preset);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    samples.push(...await controlSamples(controls));
    const captures = process.env.DINKUS_SHELL_CONTROL_CAPTURES;
    if (captures && preset === "aizome" && theme === "dark") {
      await mkdir(captures, { recursive: true });
      await page.screenshot({ path: resolve(captures, `${process.env.DINKUS_SHELL_CONTROL_PHASE ?? "after"}-${page.viewportSize()!.width}.png`), fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Both are ordinary GET forms: no account, payment or catalog mutation.
    const headerInput = page.locator(".store-header__search-input");
    for (const input of [footerInput, ...(await headerInput.isVisible() ? [headerInput] : [])]) {
      await input.focus();
      expect.soft(await input.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
      await input.fill("Everyday");
      await input.press("Enter");
      await expect(page).toHaveURL(/\/search\?q=Everyday$/);
      await expect(page.locator('[data-search-result="everyday-tee"]')).toBeVisible();
      await page.goto("/cart");
    }
    expect(writes).toBe(0);
    const report = { preset, theme, width: page.viewportSize()!.width, samples, focus, writes };
    await testInfo.attach("shell-controls", { body: JSON.stringify(report), contentType: "application/json" });
    console.log(JSON.stringify({ preset, theme, width: report.width, minimumContrast: Math.min(...samples.map(s => s.contrast)), minimumWidth: Math.min(...samples.map(s => s.width)), minimumHeight: Math.min(...samples.map(s => s.height)), focus, writes }));
    expect.soft(samples.length).toBeGreaterThanOrEqual(24);
    expect.soft(focus.style).not.toBe("none");
    expect.soft(focus.width).toBeGreaterThanOrEqual(2);
    expect.soft(samples.filter(s => s.width < 44 || s.height < 44), "44px shell targets").toEqual([]);
    expect.soft(samples.filter(s => s.contrast < 4.5), "body-sized control labels").toEqual([]);
  });
}

test("shell search remains an ordinary GET form without JavaScript", async ({ browser, baseURL, page: originalPage }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: originalPage.viewportSize()! });
  try {
    const page = await context.newPage();
    await page.goto("/cart");
    for (const selector of [".store-header__search-input", ".store-footer .widget-search__input"]) {
      const input = page.locator(selector);
      if (!await input.isVisible()) continue;
      await input.fill("Everyday");
      await input.press("Enter");
      await expect(page).toHaveURL(/\/search\?q=Everyday$/);
      await expect(page.locator('[data-search-result="everyday-tee"]')).toBeVisible();
      await page.goto("/cart");
    }
  } finally { await context.close(); }
});
