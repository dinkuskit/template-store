import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Dismiss EmDash's first-login dialog, or continue when it is already dismissed.
 *
 * The admin shell paints the editor before `currentUser` resolves. The shell
 * effect opens the dialog only when that user has `isFirstLogin`
 * (`PluginRegistry` shell `wSt`). The query is `GET /_emdash/api/auth/me`,
 * and `data.isFirstLogin` is `!user.data.welcomeDismissed`
 * (`emdash/src/astro/routes/api/auth/me.ts`). A click persists dismissal with
 * `POST /_emdash/api/auth/me` `{ action: "dismissWelcome" }`.
 *
 * `armWelcomeObserver` records that same GET. Call it before the admin
 * navigation. Editor visibility is not welcome state, and a missing read is a
 * failure rather than proof the dialog is gone.
 */
const WELCOME_BUDGET_MS = 30_000;
const WELCOME_MARK = "__templateStoreWelcomeAuth";

type WelcomeMark = { settled: true; isFirstLogin: boolean };

export async function armWelcomeObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mark = "__templateStoreWelcomeAuth";
    const host = window as unknown as Record<string, { settled?: boolean; isFirstLogin?: boolean } | undefined>;
    if (host[mark]) return;
    host[mark] = { settled: false };
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method === "GET" && url.includes("/_emdash/api/auth/me")) {
          const body = await response.clone().json() as { data?: { isFirstLogin?: unknown } };
          if (typeof body?.data?.isFirstLogin === "boolean") {
            host[mark] = { settled: true, isFirstLogin: body.data.isFirstLogin };
          }
        }
      } catch {
        // Leave the mark unsettled. The helper fails instead of guessing.
      }
      return response;
    };
  });
}

export async function dismissWelcome(page: Page, ready: Locator): Promise<void> {
  const started = Date.now();
  const isFirstLogin = await readClientIsFirstLogin(page, WELCOME_BUDGET_MS);
  const dialog = page.getByRole("dialog", { name: /Welcome to EmDash/ });
  if (isFirstLogin) {
    const start = page.getByRole("button", { name: "Get Started" });
    const remaining = Math.max(1, WELCOME_BUDGET_MS - (Date.now() - started));
    await expect(start).toBeVisible({ timeout: remaining });
    await start.click();
    await expect(start).toBeHidden();
  }
  await expect(dialog).toHaveCount(0);
  await expect(ready).toBeVisible();
}

async function readClientIsFirstLogin(page: Page, timeout: number): Promise<boolean> {
  const handle = await page.waitForFunction(
    (mark) => {
      const record = (window as unknown as Record<string, { settled?: boolean; isFirstLogin?: unknown }>)[mark];
      return record?.settled === true && typeof record.isFirstLogin === "boolean"
        ? { isFirstLogin: record.isFirstLogin }
        : undefined;
    },
    WELCOME_MARK,
    { timeout },
  );
  const value = await handle.jsonValue() as WelcomeMark;
  return value.isFirstLogin;
}
