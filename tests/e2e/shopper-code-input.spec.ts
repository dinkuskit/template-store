import { expect, test } from "@playwright/test";

// UI consumer proof only: every account call is intercepted. No email is sent,
// no real PIN is used, and no shopper session or order is created.
test("code insertion preserves surrounding whitespace and refuses malformed codes before sending", async ({ page }) => {
  const submitted: unknown[] = [];
  await page.route("**/account/sign-in/start", route => route.fulfill({
    json: { success: true, data: { ok: true } },
  }));
  await page.route("**/account/sign-in/verify", route => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: {
      success: true, data: { ok: false, error: { code: "CODE_INVALID", message: "Synthetic code refused by provider." } },
    } });
  });
  await page.goto("/account");
  await page.locator("[data-account-email]").fill("synthetic@example.test");
  const optIn = page.locator("[data-account-opt-in]");
  if (await optIn.isVisible()) await optIn.check();
  await page.locator("[data-account-start]").click();
  const code = page.locator("[data-account-code]");
  await expect(code).toBeFocused();

  for (const value of ["123456", " 123456 ", "\u00a0123456\u00a0"]) {
    await code.fill("");
    await code.focus();
    // Browser text insertion applies maxlength, unlike assigning element.value.
    // This exercises paste/autofill-like replacement, not the OS clipboard.
    await page.keyboard.insertText(value);
    await expect(code).toHaveValue(value);
    expect(await code.evaluate(input => (input as HTMLInputElement).validity.patternMismatch)).toBe(false);
    const count = submitted.length;
    await page.locator("[data-account-verify]").click();
    await expect.poll(() => submitted.length).toBe(count + 1);
    expect(submitted.at(-1)).toMatchObject({ email: "synthetic@example.test", code: "123456" });
    await expect(page.locator("[data-account-status]")).toHaveText("Synthetic code refused by provider.");
    await expect(page.locator("[data-account-verify]")).toBeEnabled();
  }

  // In particular, a seventh digit must not be truncated to a different,
  // potentially valid six-digit code and consume a verification attempt.
  for (const value of ["", "12345", "1234567", "123 456", "abcdef", "123456" + " ".repeat(40) + "7"]) {
    await code.fill("");
    await code.focus();
    await page.keyboard.insertText(value);
    await expect(code).toHaveValue(value);
    const count = submitted.length;
    await page.locator("[data-account-verify]").click();
    await expect(page.locator("[data-account-status]")).toHaveText("Enter the 6-digit numeric code from your email.");
    expect(submitted).toHaveLength(count);
    await expect(page.locator("[data-account-signed-in]")).toBeHidden();
  }
});
