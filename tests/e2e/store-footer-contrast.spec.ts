import { expect, test } from '@playwright/test';

for (const preset of ['aizome', 'forest', 'cobalt']) {
  for (const theme of ['light', 'dark']) {
    test(`footer copy remains legible over the pigment wash (${preset}, ${theme})`, async ({ page, baseURL }) => {
      await page.context().addCookies([
        { name: 'dinkus_preset', value: preset, url: baseURL! },
        { name: 'dinkus_theme', value: theme, url: baseURL! },
      ]);
      expect((await page.goto('/shipping'))?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-preset', preset);
      const footer = page.locator('[data-store-footer]');
      await expect(footer.locator('[data-widget-type="content"]')).toBeVisible();
      await expect(footer.locator('[data-widget-type="menu"] a')).not.toHaveCount(0);
      await expect(footer.locator('[data-widget-type="component"] input[type="search"]')).toBeVisible();
      const samples = await footer.locator([
        '.store-footer__eyebrow', '.store-footer__tagline', '.store-footer__heading',
        '.widget__title', '.widget__content p',
      ].join(',')).evaluateAll((elements) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = (rgb: number[]) => {
          const linear = rgb.slice(0, 3).map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        return elements.map((element) => {
          const foreground = rgba(getComputedStyle(element).color);
          let background = [0, 0, 0, 0];
          let ancestor: Element | null = element;
          // The decorative SVG is painted above the footer's base background.
          // Only a panel between the text and that wash protects its contrast.
          while (ancestor && !ancestor.matches('[data-store-footer]')) {
            const color = rgba(getComputedStyle(ancestor).backgroundColor);
            if (color[3] > 0) { background = color; break; }
            ancestor = ancestor.parentElement;
          }
          const ink = luminance(foreground);
          // Bound every possible wash color, not one favorable animation frame.
          const papers: number[] = [];
          const contrast = [0, 255].map((underlay) => {
            const alpha = background[3] / 255;
            const surface = background.slice(0, 3).map((channel) => channel * alpha + underlay * (1 - alpha));
            const paper = luminance(surface);
            papers.push(paper);
            return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
          });
          const minimum = ink >= Math.min(...papers) && ink <= Math.max(...papers) ? 1 : Math.min(...contrast);
          return { text: element.textContent?.trim(), minimum };
        });
      });
      expect(samples.length).toBeGreaterThanOrEqual(8);
      for (const sample of samples) {
        expect(sample.text).toBeTruthy();
        // All sampled copy is below WCAG's large-text threshold (18pt / 14pt bold).
        expect(sample.minimum, `${sample.text}: worst-case contrast`).toBeGreaterThanOrEqual(4.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
}
