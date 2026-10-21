# Selected variant metadata repair

Reviewed source: d05e4adb47032b3d621258919022f10ba6bf4352.
The selected-member metadata mismatch is accepted as required_fix: choosing
Medium showed $60 while the single Product Offer retained the initial $56.
The old browser expectations encoded that mismatch despite the selected-member
contract. The new product-page regression reproduced it before repair.

The server now prepares each member block through Commerce buildProductJsonLd,
using the current public product identity, member price/availability, canonical
page facts, and policies. Only data from the existing public projection is used;
no variant identifier or domain rule is invented. The default server block and
published/successful-response gates are preserved.

The member lookup uses the existing script-safe JSON serializer. The picker
selects a prepared block by member id and assigns the existing Product script
with textContent. It does not create an Offer, parse HTML, change URLs, or add
extra Product scripts. The visible availability attribute updates together with
the displayed text. Small/Medium changes, out-of-stock selection, reset/reload,
identity, canonical, and single-block behavior are exercised in desktop/mobile
browser tests. The temporary member availability test restores its fixture.

Current validation and exact source hashes are recorded in PROOF.md and
source-manifest.sha256. Earlier reviews remain attached to their reviewed
revisions; fresh final-head review belongs to the coordinator. No push, merge,
publication, deployment, or external account action is part of this repair.
