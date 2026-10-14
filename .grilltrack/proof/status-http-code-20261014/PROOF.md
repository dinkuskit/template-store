# Bounded upstream HTTP status diagnostic

For the existing upstream-HTTP failure category, only integer response statuses400 through599 are appended to a fixed local diagnostic code. The UI validates that exact bounded form before displaying its fixed support reference. Other diagnostic categories, non-success responses, cache policy, body bounds and checkout locks are unchanged.

HTTP failure bodies remain unread. No header, message, URL, request identifier, trace data or arbitrary text is exposed. Cloudflare HTML marker detection is deliberately omitted: numeric HTTP evidence is the bounded goal, not a guess about an error-page format or a routing fix.

Native workerd cases cover400/403/429/502/599, existing wrapped domain errors, spoofed diagnostic code, redirect rejection and secret-like body/header suppression. The changed cases fail on the base revision. Browser cases verify a numeric reference, rejection of an out-of-range600 reference, capability retention, zero prepare/start calls and unchanged authoritative recovery. Full verification results accompany the PR handoff.
