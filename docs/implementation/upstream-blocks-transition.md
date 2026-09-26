# First-class page blocks and local upgrade

This starter uses EmDash **0.41.0** first-class `blocks` for page-level
composition. `pages.content` remains Portable Text and is not converted
implicitly. The homepage prefers a non-empty `pages.layout`; otherwise it keeps
rendering the existing Portable Text renderer, including Dinkus plugin blocks.
The existing Commerce catalog, merchandise demo, and availability panels are
independent of this choice.

## Page blocks

The seed declares versioned `home_opener`, `rich_text`, and `query_card` block
types, then adds optional `pages.layout`. The renderer map is local to this
starter. A Home opener is a composite admin card; its headline, facts, and links
are copied field values on the page, not a live library lookup. Add or duplicate
another card to make an independent copy. Do not use `/section` as an insertion
mechanism for a `blocks` field: EmDash sections remain a Portable Text feature.

A Query Card accepts one source collection and a limit from 1 through 24. It
queries only published records and renders title, text, image, and a safe link.
No filters, pagination, price, stock, or cart behavior is included. Old
`dinkus.query-card` nodes continue through the Portable Text renderer.

## Fresh starter and initialized starter

A fresh install seeds the first-class layout. An already-initialized database
does not receive a new field or new seed content just because the source changes.
EmDash 0.41.0 `seed --on-conflict=skip` creates the new versioned block types,
but skips the existing Pages collection as a whole: it does **not** add the
new `layout` field. Conversely, `--on-conflict=update` can update seeded page
content, so do not run that on an operator-owned database. For an initialized
local starter:

1. Stop the server and back up its SQLite database.
2. Apply the seed with `--on-conflict=skip` to register the versioned block
types without changing existing entries.
3. In EmDash Admin → Content Types → Pages, add an optional field with slug
`layout`, type Blocks, and allowed types `home_opener`, `rich_text`, and
`query_card` (maximum 50 blocks). Save the schema.
4. Run the migration tool in preview mode; review the proposed output before
using its guarded `--apply` mode.

```bash
sqlite3 .artifacts/dev/content.db ".backup .artifacts/dev/pre-blocks-backup.db"
pnpm exec emdash seed --database=.artifacts/dev/content.db --uploads-dir=.artifacts/dev/uploads --on-conflict=skip seed/seed.json
```

The new schema does not copy existing `content` into `layout`. The migration
tool defaults to preview-only and emits a proposed layout from the current Home
entry. It groups ordinary Portable Text nodes into
`rich_text`, maps a Dinkus hero plus following fact rail into one copied
`home_opener`, and maps a Dinkus Query Card into the local `query_card`. It
preserves the original `content`, existing layout is never overwritten, and a
second apply is a no-op. Unknown/ordinary Portable Text is retained verbatim in
`rich_text` blocks. Standalone or reordered fact rails stay Portable Text-compatible;
they do not become opener cards with empty headings.

For an authenticated local dev session, use the guarded API mode only after a
verified backup:

```bash
DINKUS_EMDASH_SESSION_COOKIE='<session cookie>' \
DINKUS_EMDASH_MIGRATION_CONFIRM='apply:<home-entry-id>' \
node scripts/migrate-home-layout.mjs --apply --base-url=http://127.0.0.1:4321
```

The script requires the exact Home ID confirmation, refuses to replace a
non-empty layout, updates only the existing entry's `layout` while retaining
`content`, and verifies both fields after save. For a dry run, pipe the JSON response from
`/_emdash/api/content/pages/home` into the script without `--apply`; it prints
proposed `layout` JSON and performs no writes. The cookie is only read from the environment and never printed. This
operator workflow is for a throwaway/local starter; it is not a live-site or
production migration authorization.

## Revision, rollback, and mixed-runtime boundary

Block values retain `_type`, `_version`, and `_key`; EmDash page revisions store
both `content` and `layout`. Before switching a page, retain its pre-migration
revision and database backup. Rollback restores the old revision's Portable
Text and leaves the new schema field available but unused. Do not remove the
`layout` field during rollback. Sites older than EmDash 0.39 must first deploy
an unknown-field read-only/write-rejection-protected release to every runtime
before adding a blocks field. This starter pin is 0.41.0. Do not mix an older
runtime that could rewrite unknown blocks JSON as text.

## Proof boundaries

`bin/verify-web full` exercises desktop/mobile UI, admin editing, anonymous
public rendering, and the authenticated public Edit-mode toolbar for `blocks`
field cards. The first-class blocks remain card-edited in admin; this does not
claim inline editing in public Edit mode. The migration proof runs against an
initialized database separately from fresh seed proof. The legacy Dinkus Query Card test remains the owner of its
Portable Text contract; first-class layout proof owns the new schema/renderer
and preservation/rollback contract.
