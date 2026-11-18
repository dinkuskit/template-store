import { expect, test } from '@playwright/test';
import { SHOPPER_SESSION_STORAGE_KEY } from '../../src/features/shopper-account/index.js';

// Actual Account consumer with synthetic reads/saves only; all other writes
// are aborted. No email, shopper login, real profile or order operation.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`profile corrections identify and focus only the missing field (${colorScheme})`, async ({ context, page }) => {
    await page.emulateMedia({ colorScheme });
    const email = 'synthetic@example.test';
    const profile = { email, phone: null as string | null, delivery: null as Record<string, string> | null };
    const bodies: Record<string, unknown>[] = [];
    const unexpected: string[] = [];
    await context.route('**/*', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith('/account/orders')) return route.fulfill({ json: { success: true, data: { ok: true, profile, orders: [] } } });
      if (path.endsWith('/account/sign-out')) return route.fulfill({ json: { success: true, data: { ok: true } } });
      if (path.endsWith('/account/profile')) {
        const body = request.postDataJSON(); bodies.push(body);
        return route.fulfill({ json: { success: true, data: { ok: true, profile: { email, ...body } } } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) { unexpected.push(path); return route.abort(); }
      return route.continue();
    });
    await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ sessionId: 'csess_synthetic_profile', sessionToken: 'csess_synthetic_profile.0123456789abcdef0123456789abcdef', email: 'synthetic@example.test', expiresAt: 4_102_444_800 })), SHOPPER_SESSION_STORAGE_KEY);
    await page.goto('/account');
    const root = page.locator('[data-shopper-account]');
    const save = page.locator('[data-account-profile-save]');
    const name = page.locator('[data-account-profile-name]');
    const line1 = page.locator('[data-account-profile-line1]');
    const city = page.locator('[data-account-profile-city]');
    const postal = page.locator('[data-account-profile-postal-code]');
    const phone = page.locator('[data-account-profile-phone]');
    await expect(name).toBeVisible();
    await line1.fill('1 Example Way');
    // Existing guidance must survive our temporary error-description token.
    await name.evaluate(el => { el.setAttribute('aria-describedby', 'synthetic-name-hint'); const hint = document.createElement('p'); hint.id = 'synthetic-name-hint'; hint.textContent = 'Synthetic recipient hint'; el.after(hint); });
    await save.focus(); await page.keyboard.press('Enter');
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', 'synthetic-name-hint account-profile-name-error');
    await expect(page.locator('#account-profile-name-error')).toHaveText('Enter the recipient name.');
    expect(await name.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    await phone.fill('+15555550123');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toEqual([]);
    await name.focus(); await page.screenshot({ path: test.info().outputPath(`correction-${colorScheme}.png`) });
    await name.fill('Synthetic Shopper');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', 'synthetic-name-hint');
    await expect(name).toBeFocused();
    await expect(page.locator('#account-profile-name-error')).toBeHidden();
    await save.click();
    await expect(city).toBeFocused();
    await expect(city).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#account-profile-city-error')).toHaveText('Enter the city.');
    await city.fill('Testville');
    await save.click();
    await expect(postal).toBeFocused();
    await expect(page.locator('#account-profile-postal-code-error')).toHaveText('Enter the postal code.');
    await postal.fill('12345');
    await line1.fill(''); await save.click();
    await expect(line1).toBeFocused();
    await expect(page.locator('#account-profile-line1-error')).toHaveText('Enter address line 1.');
    await line1.fill('1 Example Way'); await save.click();
    await expect(page.locator('[data-account-status]')).toContainText('Saved your default shipping address');
    expect(bodies).toEqual([{ phone: '+15555550123', delivery: { name: 'Synthetic Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '12345', country: 'US' } }]);
    // Clearing is deliberately allowed without satisfying address fields.
    await city.fill(''); await save.click(); await expect(city).toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-account-profile-clear]').click();
    await expect(name).toHaveValue('');
    await expect(root.locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(root.locator('[data-account-profile-error]:visible')).toHaveCount(0);
    expect(bodies.at(-1)).toEqual({ phone: null, delivery: null });
    // Optional address / phone-only save retains the old request contract.
    await phone.fill('+15555550123'); await save.click();
    // Observing the request is not observing completion: its profile response
    // replaces the form. Wait before starting the next draft (including in CI).
    await expect(page.locator('[data-account-status]')).toContainText('Saved your default shipping address');
    await expect(save).toBeEnabled();
    expect(bodies.at(-1)).toEqual({ phone: '+15555550123', delivery: null });
    // Explicit sign-out erases corrections; cross-tab guards are a separate PR.
    await city.fill('Testville'); await save.click(); await expect(name).toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-account-signout]').click();
    await expect(page.locator('[data-account-signed-out]')).toBeVisible();
    await expect(root.locator('[aria-invalid="true"]')).toHaveCount(0);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
