# Store sidebar folder (admin-one-store-folder-128)

Decision: `admin-one-store-folder-128` in dinkuskit/dinkuskit (step (a) of
`store-connect-order-135`). One **Store** folder in the EmDash sidebar holds the
template store's Products and Product categories plus the Commerce, Payments and
Ship pages.

## What was run (22 Nov 2026)

A fresh store from this branch's seed, on EmDash 1.4.0 under `astro dev` (Node,
SQLite), with:

- Commerce: the Registry build of the matching Commerce branch
  (`claude/project-thread-972mi5`, base c325fe4), mounted through `sandboxed: [...]`
  as `DINKUS_PAIRED_COMMERCE_DIR` does;
- Payments (base ebea640) and Ship (base 55ca419): their branches packed with the
  official Registry packager (`bundlePlugin`), mounted the way
  `astro.playground.config.mjs` mounts the playground's packed plugins.

Each plugin's manifest says `"group": "Store"`; the seed gives `products` and
`categories` `"group": "Store"`. Setup ran through `/_emdash/api/setup/dev-bypass`,
then `shot.cjs` signed in, opened the folder and took the pictures.

## What it shows

- `store-folder.png`: the sidebar's Content section has one **Store** folder with
  Product categories, Products, Payment settings, Shipments, Orders and Commerce
  settings. There is no Dinkus Commerce, Dinkus Payments or Dinkus Ship folder.
- `payment-settings-in-store.png`: Payment settings opens from that folder at its
  usual address, with the folder still open around it.

A store made before this change gets the same folder from the self-upgrade step
`006_store_folder` (tests/unit/storefront-upgrades.test.ts). That step leaves a
folder the owner already gave a collection alone.
