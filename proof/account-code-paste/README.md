# Keep the complete sign-in code until validation

During Backroad Bum's real shopper-email qualification, pasting a six-digit code with a leading space lost its last digit. Unchanged upstream `23207d91b93b2e798b90cc446941b5aae5a10821` reproduces the same failure. Its `maxlength="6"` also changes an invalid seven-digit insertion into a different six-digit verification request.

The patch removes that destructive input cap, aligns the HTML pattern with the existing trim-then-six-digits handler, and gives the code field a proportional width using the starter's existing styling. It changes no account API, session, email transport or Commerce validation.

## Acceptance and observed proof

| Requirement / source | Populated passing case | Refusal case | Environment / evidence |
| --- | --- | --- | --- |
| Existing `readFieldValue` trim and exact six-digit guard in `shopper-account-client.ts`; the UI labels the code as six digits | Plain `123456`, surrounding ASCII spaces and NBSP retain the full insertion and send exactly `123456` | Empty, five/seven digits, letters, an internal space and a long padded value ending in a seventh digit make no verification request | Actual Astro `/account`, EmDash 1.4.0, pinned Commerce 0.8.0 Registry proof fixture; Chromium at 1440/390, Light/Dark; `tests/e2e/shopper-code-input.spec.ts` |
| Existing provider-error recovery | Provider refusal is displayed and Verify is enabled again | No synthetic response creates a signed-in session | Every start/verify request is intercepted; no email, live PIN, shopper capability, payment or order is created |
| `design.md`: keep the starter's visual language, keyboard use and narrow-screen fit | Existing label, numeric keyboard, one-time-code autocomplete and styles retained | No Backroad Bum branding or horizontal overflow introduced | Public desktop/mobile Before/After captures below; `audit-dom.mjs` also reports inherited page contrast/footer-target defects, not a clean whole-page audit |

`keyboard.insertText` exercises browser text insertion and its maxlength behavior. This is paste/autofill-like replacement, **not** an OS clipboard, physical phone, or provider authentication qualification.

### Captured browser output (both widths)

```text
main: input=" 123456 " retained=" 12345" verificationRequests=0
head: input=" 123456 " retained=" 123456 " verificationBody.code="123456"
main: input="1234567" retained="123456" verificationRequests=1
head: input="1234567" retained="1234567" verificationRequests=0
```

The red After status is the deliberately intercepted provider refusal: it proves the complete code reached the verification boundary, not that a shopper signed in.

### Visible proof

| Viewport | Before (unchanged main) | After |
| --- | --- | --- |
| Desktop, 1440 | ![Before desktop](https://backroadbum.com/pr-proof/template-store-account-code-paste/before-1440.png) | ![After desktop](https://backroadbum.com/pr-proof/template-store-account-code-paste/after-1440.png) |
| Phone, 390 | ![Before phone](https://backroadbum.com/pr-proof/template-store-account-code-paste/before-390.png) | ![After phone](https://backroadbum.com/pr-proof/template-store-account-code-paste/after-390.png) |

## Verification

Node 24.22.0: `bin/verify-web quick` passes (Astro 300 files, zero errors/warnings; 614 unit tests; 115 workflow tests, two intentional skips; feature/text/diff audits). `pnpm build:registry` with CI's synthetic resource IDs and `.github/scripts/assert-registry-build.mjs` pass without deployment. The pinned Commerce Registry build passes its 128 KiB size gate at 129,540 bytes. The Node build and four targeted Chromium code-input runs pass.

The broader desktop browser run stops at the unrelated admin-product-categories welcome initialization timeout; a fresh detached unchanged-main worktree fails at the same `helpers/welcome.ts:64` wait. Its dev process also exhausts the 850 MiB heap. Remaining full browser cases are not locally qualified; GitHub Actions runs the full matrix. The complete Light/Dark 390/1440 DOM audit reports the **same** 19 errors and six warnings on unchanged main and this head (dark account-card text and shared shell/footer controls). No clean whole-page contrast/touch audit is claimed, and those inherited styling defects are not silently folded into this input repair.

Media stays outside git. The merchant's equivalent paste fix is already live; this neutral starter patch does not redeploy Backroad Bum or modify its signed plugins.
