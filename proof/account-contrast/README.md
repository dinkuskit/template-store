# Keep chalk Account surfaces readable in Dark mode

Backroad Bum's shopper-email/input qualification exposed the unchanged starter Account page's dark text pairing: chalk cards and white inputs retained their light backgrounds while inheriting light-colored Dark-mode ink. On main `23207d91b93b2e798b90cc446941b5aae5a10821`, actual browser samples reach only **1.09:1** for headings, labels, status and profile buttons. This is separate from the code-paste repair in PR #230.

Resolve the existing `light-dark()` tokens and native fields in a local `color-scheme: light` on the explicitly fixed-chalk cards/status. Give normal status text an explicit existing ink token. The surrounding page, preset, theme choice, dark vault, content, layout and account protocol are unchanged; there is no new palette or global theme override.

## Acceptance-to-proof

| Requirement / independent source | Populated passing case | Adverse case | Capable environment / evidence |
| --- | --- | --- | --- |
| `design.md` Confirmed constraints: sufficient contrast and readable status, while preserving the locked chalk/vault visual language; WCAG 1.4.3 normal text >=4.5:1 | Signed-out code form, normal status, a populated order and shipping profile remain readable | Main dark headings/status/buttons at1.09:1; provider refusal and successful profile-save status must also stay readable | Actual Astro `/account`, EmDash1.4.0 and pinned Commerce0.8.0 Registry proof store; Chromium1440/390; three presets, Light/Dark and Aizome System with a dark OS preference |
| `design.md` dual-theme presets and no foreign branding | Chalk remains `rgb(252,251,248)`, vault remains `rgb(27,42,74)`; Light-mode text also passes | Do not force the entire page or the dark vault into Light mode | Existing CSS/layout preserved; four public Before/After images and computed rendered-color tests |
| Existing Account interaction ownership | Normal start status, intercepted provider error, populated profile save and sign-out still render | Unknown writes abort rather than reaching a real provider | Every account response is synthetic; no real email, PIN, capability, profile, order, payment or fulfillment action is created |

The browser test composites computed foreground/background colors through painted ancestor layers rather than trusting token names or a DOM-only unit environment. It samples labels, headings, typed input values, select text, status, buttons, order facts and badges; all normal-text samples must reach4.5:1. This is not certification of every WCAG criterion, browser, native widget popup or physical phone.

## Visible Before/After

Desktop shows the signed-out code form and normal status; phone shows a populated synthetic signed-in order. All account requests in these captures are intercepted. The dummy `123456` and fixture identities have no real authority.

| | Main | Candidate |
| --- | --- | --- |
| Desktop1440, Dark | ![Before desktop](https://backroadbum.com/pr-proof/template-store-account-contrast/before-1440.png) | ![After desktop](https://backroadbum.com/pr-proof/template-store-account-contrast/after-1440.png) |
| Phone390, Dark | ![Before phone](https://backroadbum.com/pr-proof/template-store-account-contrast/before-390.png) | ![After phone](https://backroadbum.com/pr-proof/template-store-account-contrast/after-390.png) |

## Verification

Node24.22.0: `bin/verify-web quick` passes (614 units,115 workflow passes/two intentional skips, feature/text/diff audits); final Astro check300 files has0 errors/0 warnings and two inherited hints. Registry build with CI's synthetic resource IDs and `assert-registry-build.mjs` pass without deployment; the Node build passes. The unchanged pinned Commerce backend measures129540 bytes against131072 allowed.

The new tests fail on unchanged main's1.09:1 Dark-mode text, then pass14/14 on the candidate: each run checks93 rendered samples across normal status, refusal, populated order/profile and saved status, with minimum5.6:1 or better and zero unexpected writes. Aizome System is tested under a dark OS preference. The full local matrix is not claimed: its unrelated admin welcome timeout reproduces on this same unchanged main in the recent PR230 baseline; GitHub Actions runs the complete matrix.

A complete-page `audit-dom.mjs` still reports inherited shared header/footer contrast and touch-target findings. The changed Account copy no longer appears among its failures; this does not claim a clean whole-page audit or fix those unrelated controls. Backroad Bum's custom theme uses adaptive surfaces rather than fixed chalk, so downstream adoption must explicitly preserve its inherited color scheme instead of forcing those dark brand surfaces light.
