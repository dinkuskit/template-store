# Checkout status proxy origin repair

The status proxy validates the browser Origin against the explicitly configured
EMDASH_SITE_URL and request URL. Contradictory Fetch Metadata is rejected. It
forwards that canonical origin to the fixed Commerce status path with the
existing capability, no browser cookies or authorization, no cache and no
redirect following. It does not prepare, start or reset a checkout.

Focused tests exercise the real Commerce admission function and the actual
proxy. A separately bundled proxy passed the compiled Commerce 0.2.2 admission
function with trusted input; missing, foreign, cross-site and foreign-host input
were denied before forwarding. See compiled-admission.json. These are synthetic
local transport proofs, not a claim of deployed recovery or provider contact.

Existing request/response size bounds and generic upstream-error redaction are
retained. Full repository verification, CI and exact-head reviews remain
required before owner rollout. After rollout use the retained checkout's normal
status action; do not manipulate browser storage or mint a replacement.
