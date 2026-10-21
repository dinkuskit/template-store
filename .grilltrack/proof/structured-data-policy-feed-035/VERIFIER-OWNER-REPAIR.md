# Owner-approved verifier repair

Reviewed source: `a2138c73cfe9f6016c700186f093bc0c6af6d6e6`.
Two additional verifier findings were reproduced after the automatic repair cap:
malformed linked-product feeds passed on status/MIME alone, and raw encoded
HTML SKU attributes falsely mismatched decoded JSON-LD values. Both are
accepted as `required_fix`. The owner explicitly approved one additional
bounded repair pass; this does not restart automatic repair authority.

The verifier now uses strict XML parsing and CSV parsing with the expected
header/row width in both linked and unlinked paths. Actual pinned Commerce
builder output, including opted-out empty feeds and quoted/newline fields,
passes. HTML attribute entities are decoded before SKU equality is checked;
real mismatches still fail. No storefront product or Commerce API changed.

Focused HTTP tests, the full verification result, package pins, and source
manifest are recorded in `PROOF.md`. Further findings return to coordinator
adjudication; no push, merge, publication, or deployment is authorized here.
