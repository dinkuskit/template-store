# Native workerd status proxy redirect proof

The built route from base `877e04671118e439dc399c348906efdf5b0a8d4b` returned503 with the correct origin binding before sending an outbound request. Native Workers fetch rejected `redirect: error`; missing origin separately returned403. The local-only `manual` comparison returned200 for a synthetic valid status and rejected302 without following. See baseline-built-runtime.json.

The regression test bundles the actual route and executes it under workerd. Only the outbound network service is synthetic; global fetch remains native. Before the fix, the200 case returned503 and redirect cases made zero outbound calls. After the fix, all four tests passed:200 response accepted,302 and307 rejected, no redirect follow or Location leakage, trusted Origin/capability preserved, cookies and authorization absent. No external requests, live capability, checkout start, deployment or browser storage were used.
