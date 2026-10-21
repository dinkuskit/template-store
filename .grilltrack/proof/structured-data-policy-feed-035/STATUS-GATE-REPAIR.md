# Product metadata status gate

Source reviewed: `db5601dce3456ee228153264a4acad1a74fe199b`.

Accepted finding (`required_fix`): a shipping managed/unmanaged link whose
Commerce item is missing can set HTTP 404 while leaving both
`lookupUnavailable` and `noLongerAvailable` false. The prior metadata
expression could then call the editorial preview builder for that error page.

The Product JSON-LD expression now first checks the response status through
`allowsProductJsonLd`. Only 2xx responses can emit metadata. Existing status
assignments, legitimate 200 editorial previews, and 503 handling remain
unchanged. The focused unit check covers 200 admission and redirect, 404, 410,
500, and 503 refusal. The shipping browser check retains the successful
editorial preview and 503 assertions and adds missing-page 404 omission.

Current verification results and source identity are recorded in `PROOF.md`
and `source-manifest.sha256`. Fresh final-head CI remains the coordinator's
promotion check.
