# Playground on Commerce 0.7.0, Payments 0.5.0 and Ship 0.3.1

Covers template-store#183. On 31 Oct 2026 Ronald asked for the template store and the Playground to run the new stable releases, so he can test and show them.

The PR changes the pins:

- Commerce source `v0.7.0` at `4c975824923626e52460d6fbad29d5e32613a319`
- Payments `v0.5.0` at `4589ac818017b5a65cdde29a60aaec23aca5f795`
- Ship `v0.3.1` at `b032a1d689baf6674b900a3c9c57c191d64733e6`

It also changes the things that depend on the renamed admin pages: the Ship preview check in `ci.yml` and the tour's buttons and words.

All runs below are of head `caf990e38dbc3a1a514857cb29c64e19340b975c`. The commit that adds this folder changes no code.

## Release deltas

**`manifest-delta.txt`.** Payments v0.4.0 and Ship v0.3.0 were packed with the same official packager that `scripts/prepare-playground-plugins.mjs` uses, then compared with the packed v0.5.0 and v0.3.1 manifests.

- The only key that differs in either plugin is `admin.pages`: a new label and a sidebar `group`.
- These are equal between versions: `id`, `capabilities`, `allowedHosts`, `declaredAccess`, `storage`, `routes`, `hooks` and `admin.settingsSchema`.
- Both manifests have the same keys.

**Commerce.** v0.7.0 promotes 0.7.0-beta.6, which has the same code as beta.4.

- `dist/sandbox/plugin.mjs` is byte-identical, sha256 `a630ca23…`.
- `dist/sandbox/index.mjs` differs only in its `"version"` string. Its new digest is in `scripts/verify-paired-product-on-sale.mjs`.

## Fresh visitor store on this PR's preview

**`fresh-store-pr-183.txt`** is `fresh-store-flow.sh https://pr-183.playground.dinkuskit.com`, after CI's Playground deployment published head `caf990e` there and passed its own checks. All 14 steps pass:

- the playground and shop open;
- Payments' Connect, then Continue, gives "Connected: Stripe test mode", which survives a reload;
- Ship's page is "Shipments", its Connect and Check list the sample orders, and it makes a practice label on paid order #1004;
- the tour card ticks off Connect Payments and Ship an order;
- the tour page says "Open Payment settings" and "Open Shipments".

## Existing visitor store across the upgrade

**`cross-version.sh`** runs main's Playground build (Payments 0.4.0, Ship 0.3.0, Commerce 0.7.0-beta.4) and then this PR's build. Both run under `wrangler dev` with one `--persist-to` directory and one cookie jar, so the new Worker opens the same visitor Durable Object the old one wrote.

**`old-build-store.txt`** is what the old build did to that store:

- Payments was connected (Stripe test mode).
- Ship's page was still named "Shipping"; Ship was connected and made practice label `TEST979503883` on #1004.
- The tour was at 3 of 4 steps.

**`same-store-new-build.txt`** is the new build reading that same store, with no reconnect:

- The tour is still at 3 of 4.
- Payments loads "Connected: Stripe test mode", and Check connection keeps it.
- Ship's page, now "Shipments", lists #1004 as Label bought, and the order shows the same `TEST979503883` label.
- The new build cancelled that label and made a new one (`TEST797185248`), and the old label moved to Earlier labels. So the new code also writes to the old store's records.

One visible difference: in that store, the tour page still shows the old words, "Open Payments …" and "Open Shipping …". The words are the visitor's own CMS page `playground-tour`, seeded when the store was made. A store made after the deploy gets the new words, as the fresh run shows. The button labels come from code and are new in both. A visitor store lasts at most an hour (EmDash playground TTL 3600 s), and both wordings point at the right sidebar folders ("Dinkus Payments" and "Dinkus Ship").

## Other checks on this head

| Check | Result |
|---|---|
| `pnpm exec vitest run` | 59 files, 567 tests passed (includes `playground-existing-state`, `playground-plugins`) |
| `node --test tests/workflows/*.test.mjs` | 102 passed, 2 skipped |
| `bin/verify-web full` | passed |
| `pnpm verify:paired-product-on-sale` | 5 passed on Commerce v0.7.0 |
| `pnpm verify:playground-config` | passed |
| CI on `caf990e` | Store verification (desktop, phone), Playground build and Playground deployment all passed |
