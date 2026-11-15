import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SHOPPER_SESSION_HEADER, SHOPPER_SESSION_STORAGE_KEY } from '../../src/features/shopper-account/index.js';

// UI synchronization proof only. Every account call is synthetic and every
// other non-read request is blocked; no mail/session/profile/order is created.
const session = (who: string) => ({
  sessionId: `csess_synthetic_${who}`,
  sessionToken: `csess_synthetic_${who}.0123456789abcdef0123456789abcdef`,
  email: `shopper-${who}@example.test`, expiresAt: 4_102_444_800,
});
const profile = (who: string) => ({
  email: session(who).email, phone: null,
  delivery: { name: `Synthetic Shopper ${who.toUpperCase()}`, line1: `${who === 'a' ? 1 : 2} Example Way`, city: 'Testville', region: 'NC', postalCode: '27601', country: 'US' },
});
const putSession = (page: Page, who: string) => page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SHOPPER_SESSION_STORAGE_KEY, value: session(who) });
const envelope = (data: object) => ({ success: true, data });
const orders = (who: string) => envelope({ ok: true, profile: profile(who), orders: [{
  orderId: `ord_synthetic_${who}`, number: who === 'a' ? 101 : 202, status: 'processing',
  paidAt: '2026-11-01T12:00:00Z', total: { currency: 'USD', minor: '1200' },
  lines: [{ catalogItemId: 'synthetic-notebook', name: 'Synthetic notebook', quantity: 1, unitPrice: { currency: 'USD', minor: '1200' } }], choices: [], delivery: profile(who).delivery, phone: null,
}] });

async function fixture(context: BrowserContext) {
  const writes: { who: string; recipient?: string }[] = [];
  const unexpected: string[] = [];
  await context.route('**/*', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const who = request.headers()[SHOPPER_SESSION_HEADER] === session('b').sessionToken ? 'b' : 'a';
    if (path.endsWith('/account/orders')) return route.fulfill({ json: orders(who) });
    if (path.endsWith('/api/guest-cart/snapshot')) return route.fulfill({ json: { products: [] } });
    if (path.endsWith('/account/sign-in/start') || path.endsWith('/account/sign-out')) return route.fulfill({ json: envelope({ ok: true }) });
    if (path.endsWith('/account/sign-in/verify')) return route.fulfill({ json: envelope({ ok: true, profile: profile('b'), capability: { sessionId: session('b').sessionId, session: session('b').sessionToken, expiresAt: '2100-01-01T00:00:00Z' } }) });
    if (path.endsWith('/account/profile')) {
      writes.push({ who, recipient: request.postDataJSON().delivery?.name });
      return route.fulfill({ json: envelope({ ok: true, profile: profile(who) }) });
    }
    if (!['GET', 'HEAD'].includes(request.method())) { unexpected.push(path); return route.abort(); }
    return route.continue();
  });
  return { writes, unexpected };
}

async function openAsA(page: Page) {
  await page.goto('/account');
  await putSession(page, 'a');
  await page.reload();
  await expect(page.locator('[data-account-current-email]')).toHaveText(session('a').email);
  await expect(page.locator('[data-account-profile-name]')).toHaveValue(profile('a').delivery.name);
}
async function expectCleared(page: Page) {
  await expect(page.locator('[data-account-signed-out]')).toBeVisible();
  await expect(page.locator('[data-account-signed-in]')).toBeHidden();
  await expect(page.locator('[data-account-profile-name]')).toHaveValue('');
  await expect(page.locator('[data-account-orders-list]')).toBeEmpty();
  await expect(page.locator('[data-account-current-email]')).toBeEmpty();
}
async function expectBStored(page: Page) {
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).email, SHOPPER_SESSION_STORAGE_KEY)).toBe(session('b').email);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`session changes clear a second tab before it can save the former profile (${colorScheme})`, async ({ context, page }) => {
    await page.emulateMedia({ colorScheme });
    const calls = await fixture(context);
    await openAsA(page);
    const second = await context.newPage();
    await second.emulateMedia({ colorScheme });
    await second.goto('/account');
    await expect(second.locator('[data-account-profile-name]')).toHaveValue(profile('a').delivery.name);
    await page.locator('[data-account-signout]').click();
    await expectCleared(page);
    await expectCleared(second);
    await page.locator('[data-account-email]').fill(session('b').email);
    await page.locator('[data-account-start]').click();
    await page.locator('[data-account-code]').fill('123456');
    await page.locator('[data-account-verify]').click();
    await expect(page.locator('[data-account-current-email]')).toHaveText(session('b').email);
    await expect(second.locator('[data-account-status]')).toContainText('changed in another tab');
    await expectCleared(second);
    expect(calls.writes).toEqual([]);
    await second.reload();
    await expect(second.locator('[data-account-profile-name]')).toHaveValue(profile('b').delivery.name);
    await second.locator('[data-account-profile-save]').click();
    await expect(second.locator('[data-account-status]')).toContainText('Saved your default shipping');
    expect(calls.writes).toEqual([{ who: 'b', recipient: profile('b').delivery.name }]);
    expect(calls.unexpected).toEqual([]);
  });
}

for (const operation of ['save', 'clear', 'sign-out']) {
  test(`a queued/missing storage event cannot ${operation} a different displayed session`, async ({ context, page }) => {
    const calls = await fixture(context);
    await openAsA(page);
    let signouts = 0;
    await page.route('**/account/sign-out', route => { signouts++; return route.fulfill({ json: envelope({ ok: true }) }); });
    // Same task: the browser has no chance to deliver a storage/focus event.
    await page.evaluate(({ key, value, operation }) => {
      localStorage.setItem(key, JSON.stringify(value));
      if (operation === 'save') document.querySelector<HTMLFormElement>('[data-account-profile-form]')!.requestSubmit();
      else document.querySelector<HTMLButtonElement>(operation === 'clear' ? '[data-account-profile-clear]' : '[data-account-signout]')!.click();
    }, { key: SHOPPER_SESSION_STORAGE_KEY, value: session('b'), operation });
    await expectCleared(page);
    await expectBStored(page);
    expect(calls.writes).toEqual([]);
    expect(signouts).toBe(0);
    expect(calls.unexpected).toEqual([]);
  });
}

test('an unrelated storage change retains the current account and unsaved draft', async ({ context, page }) => {
  const calls = await fixture(context);
  await openAsA(page);
  await page.locator('[data-account-profile-name]').fill('Unsaved synthetic draft');
  const other = await context.newPage();
  await other.goto('/account');
  await other.evaluate(() => localStorage.setItem('synthetic-unrelated-key', 'changed'));
  await page.bringToFront();
  await expect(page.locator('[data-account-current-email]')).toHaveText(session('a').email);
  await expect(page.locator('[data-account-profile-name]')).toHaveValue('Unsaved synthetic draft');
  expect(calls.writes).toEqual([]);
  expect(calls.unexpected).toEqual([]);
});

for (const operation of ['orders', 'snapshot', 'profile', 'sign-out', 'verify']) {
  test(`a delayed ${operation} response cannot restore/discard the newer tab session`, async ({ context, page }) => {
    const calls = await fixture(context);
    if (operation === 'orders' || operation === 'snapshot') {
      await page.goto('/account');
      await putSession(page, 'a');
    } else await openAsA(page);
    let release!: () => void, arrived!: () => void;
    const pending = new Promise<void>(resolve => { arrived = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const path = operation === 'verify' ? '/account/sign-in/verify' : operation === 'snapshot' ? '/api/guest-cart/snapshot' : `/account/${operation}`;
    await page.route(`**${path}*`, async route => {
      arrived(); await wait;
      const data = operation === 'orders' ? orders('a') : operation === 'snapshot' ? { products: [] } : operation === 'profile' ? envelope({ ok: true, profile: profile('a') }) : operation === 'verify' ? envelope({ ok: true, profile: profile('a'), capability: { sessionId: session('a').sessionId, session: session('a').sessionToken, expiresAt: '2100-01-01T00:00:00Z' } }) : envelope({ ok: true });
      await route.fulfill({ json: data });
    });
    if (operation === 'orders' || operation === 'snapshot') await page.reload();
    else if (operation === 'profile') await page.locator('[data-account-profile-save]').click();
    else if (operation === 'sign-out') await page.locator('[data-account-signout]').click();
    else {
      await page.locator('[data-account-signout]').click();
      await page.locator('[data-account-email]').fill(session('a').email);
      await page.locator('[data-account-start]').click();
      await page.locator('[data-account-code]').fill('123456');
      await page.locator('[data-account-verify]').click();
    }
    await pending;
    await putSession(page, 'b');
    // No synthetic storage event: the response itself must recheck storage.
    const returned = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(path));
    release(); await returned;
    await expectCleared(page);
    await expect(page.locator('[data-account-status]')).toContainText('changed in another tab');
    await expectBStored(page);
    expect(calls.writes).toEqual([]); // delayed profile is intercepted separately
    expect(calls.unexpected).toEqual([]);
  });
}
