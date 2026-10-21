# Fresh-main integration

Premerge source: a48c939a4ea9aba3a2b195d4fab72dffa68d3a45.
Fetched main: bd0170ce2462f4b7d89976dee9338f779609b120 (#114).
Integration is a two-parent merge, not a rebase.

The actual conflict set was only src/features/commerce-catalog/index.ts:
both branches changed imports. The resolution retains #114's
readInstalledCommerceProducts import and #35's types.ts projection import.
The redundant old media type import is omitted. No domain behavior was
rewritten to resolve the conflict.

The automatic merges retain #114's bounded cart item lookups and longer
snapshot/checkout timeouts, alongside #35's public projection parsing,
metadata/policies/feeds and selected-variant metadata changes. Ledger and
events are unchanged from the premerge branch; both Git histories are retained.

Current targeted checks are recorded in PROOF.md. The complete local suite
at a48c939 is historical evidence, not a complete run of this merge. Fresh
head CI and reviews remain required. No package, deploy, or merge-PR action
was performed by the integration worker.
