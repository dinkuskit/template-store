# Registry sandbox budget

The Registry Cloudflare profile now wraps the pinned stock runner with a
32-subrequest limit. The limit applies to every installed sandbox plugin on this
profile. The selector leaves Node, default Cloudflare and playground profiles
unchanged. No package pin, Commerce artifact or authentication setting changes.

Focused verification:

- The actual stock runner passes `subRequests: 32` and `cpuMs: 50` to a simulated
  Worker Loader, retaining `globalOutbound: null`, manifest capability scope,
  storage scope, database and write-guard references.
- The actual stock bridge rejects content access without `content:read`.
- The stock runner still times out after 30 seconds.
- Profile selection tests cover Registry, Node, default and playground configs.
- `published-budget.json` records an independent execution of the published
  Commerce 0.2.0 backend through its existing workerd fixture with an explicitly
  simulated storage-RPC budget. At 10, creation persists one draft but fails on
  call 11. At 32, creation and list render succeed in 19 calls with one draft.
  Measured price, weight and choice edits take 16, 17 and 31 calls. Reload/open
  recovery and same-command replay retain one draft.

This is not deployed Worker Loader proof or a claim that arbitrary catalog size
fits the cap. Full repository verification, CI and exact-head independent reviews
must pass before rollout. After rollout, inspect and reuse the existing draft;
a failed response must not be treated as proof that its write rolled back.
