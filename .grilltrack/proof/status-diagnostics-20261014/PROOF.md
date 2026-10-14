# Truthful checkout status diagnostics

The checkout status proxy maps only exact known error codes to fixed local categories. Domain origin/capability/not-found/unavailable responses, proxy origin, redirect/HTTP, invalid bounded response, and fetch failures remain non-success responses with no-store. Unknown domain errors remain generic. No upstream messages, headers, URLs, identifiers, or exception values are forwarded.

Cart recovery treats a parsed domain error as unavailable rather than authoritative pending. It shows fixed text and an allowlisted support reference; it retains the capability and all existing edit/start locks. No retry permission or automatic action is introduced. This makes failures observable; it does not assert the cause of any live retained-checkout failure.

The new native workerd tests fail on the base revision for the missing diagnostic categories. After implementation they verify known envelopes, unknown private-looking values, redirect rejection and header suppression. Browser tests cover capability retention, locked start/edit controls, zero prepare/start calls, unknown-message suppression, and subsequent authoritative recovery. Full verification results are recorded with the PR handoff.
