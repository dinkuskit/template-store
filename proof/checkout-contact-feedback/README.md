# Checkout contact feedback

Backroad Bum dogfooding found that Continue with an empty email leaves focus on the button while its alert is offscreen above the checkout header: −1067px on desktop1440 and −1788px on phone390. The generic contact reader uses the same global-status path. This candidate keeps existing validation messages/rules, but places local contact errors inside their fieldset and focuses that alert only after an explicit rejected submission; input/change clears it without moving focus.

| Requirement | Expected case and observed proof |
| --- | --- |
| Understand and correct a refused contact submission | Six shipping Chromium desktop/Pixel7 cases pass, including the dedicated local-feedback case, existing physical/digital proof and delivery forwarding. Empty/invalid email, missing US state and incomplete billing expose the same message, focused and in the viewport, without a start request; Tab reaches Email. |
| Preserve input, intent and Commerce authority | Editing input/select clears only the local error and retains focus. Invalid submissions keep cart storage and typed email; corrected input reaches one synthetic start with the existing contact/billing shape. Existing empty-delivery Commerce refusal and stale digital-delivery omission remain covered. No real payment or signed-plugin mutation. |
| Keep the patch qualified and reviewable | Node24.22.0: Astro check0errors/0warnings,581unit tests,115workflow passes with2existing optional skips, feature/text audits and Node build. CI-shaped Cloudflare Registry build/config assertion/credential-free Wrangler dry-run pass. Commerce bundle129540/131072bytes with1532bytes headroom is unchanged. |

Targeted command: `pnpm exec playwright test tests/e2e/guest-checkout-feasibility.spec.ts --grep 'contact validation stays|checkout contact proof covers|checkout start sends' --project=shipping-chromium-desktop --project=shipping-chromium-mobile`.

The complete local `CI=1 pnpm verify` stops in the inherited admin welcome observer (`helpers/welcome.ts:64`) with catalog seed refusal and admin heap exhaustion;141other cases did not run. The same untouched upstream4a421e5 failure is recorded in the earlier baseline/gallery qualification, so no full local browser pass is claimed; GitHub Actions must run its full matrix. Ignored `runs/checkout-contact-feedback/` contains the reviewed desktop/phone renders; screenshots are not committed. This is a presentation fix, not a changed payment, geography, validation or recovery contract.
