# Closeout: unpriced products stay off the dogfood home

Track: `gt-20260926022138-947c39`
Closed: user confirmed stop; do not start the admin grill yet.

## Why it stopped

Public-home catch-up is implemented and verified. Bobby closed the track so
he can pivot. EmDash Regular/Sale admin remains parked, not started.

## Verified results

- Commerce pin `3f20fe96d5b3104c4b599e669d18f54fd8ab2587`
- Public home: Regular `$12.00`; Sale strikes Regular and shows `$10.00`
- Unpriced draft `DINKUS-DEMO-UNPRICED` is off `/`
- Admin Pages `home` remains operable without Regular/Sale boxes
- `bin/verify-web full` passed on `18c39c3135abe0a585e9d1f630c38068d4dff9b9`

## Deferred / unresolved

- Visual Regular/Sale admin (named next grill, not started)
- Cart, checkout, payments
- Merge of [template-store #11](https://github.com/dinkuskit/template-store/pull/11) stays human-gated

## Proof / delivery

- Implementation: `docs/implementation/unpriced-public-home.md`
- Review: `docs/implementation/REVIEW-unpriced-public-home.md` (clean)
- Browser assets: https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/template-store-pr-11-18c39c3135ab
- Delivery: PR #11, not merged
