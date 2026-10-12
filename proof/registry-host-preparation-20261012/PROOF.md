# Registry host preparation

Base: `e0097b5bbf5b4dcb1d47ce4070222c2bd53f78b8`.
Toolchain: Node 22.23.2, pnpm 11.9.0, Astro 7.1.3, EmDash and Cloudflare adapter 1.2.0, Wrangler 4.145.0.

## Scope

A selected Wrangler config now determines the build-time catalog profile as well as the Astro adapter. A shipping Cloudflare config requires LOADER and selects the published sandbox runner. Native development configs retain their independent profile. Shipping catalog dispatch uses the normalized Registry identity and never falls back to the native identity.

## Public artifact evidence

Official discovery: `https://registry.emdashcms.com`.
Publisher: `did:plc:ekk4pjmkh3k3ql2kfoex3qt4` (`smokyco.bsky.social`).

| Package | Version | Runtime identity | SHA-256 | Bytes |
| --- | --- | --- | --- | --- |
| dinkus-commerce | 0.1.0 | r_gshdrqaldna3r7sn | df542fba5d84df719d05dc58fbbf1131a599f365ce956db4682383ad35fd8de3 | 50605 |
| dinkus-payments | 0.1.0 | r_3brsc2on3bu673rn | ee6b9c0c697e600e3b426e809093e1889a05eed8d4e74e1f5484d8381a7d5b72 | 9120 |

Commerce profile CID: `bafyreia64hmqiboouhoisdchjphcm4y6drheyunjbh6s65m2fy77szzrwm`.
Commerce release CID: `bafyreibtwmjibvs3kkaripr3fmo23m66kzzeo7i2w572g5cbwpkeyc2wkq`.
Payments profile CID: `bafyreifvt4e6ivkv5qjxy2uzujhtzrqowjtdbkqytz4gl4btxnuwxykqaq`.
Payments release CID: `bafyreihrrjunbzgumd732fww6hhotcpj7crpuaiiat7e5veao56ezhhgky`.

DirectPdsClient verified the publisher's signed records. The official registry-verification package accepted each record pair, downloaded bundle, declared checksum and package/version identity. Both releases report `unattested`, with provenance `absent-optional`: this is not a source-build attestation. These checks do not establish installation in a host.

## Verification and limits

Run `pnpm verify` for repository checks, including desktop/mobile browser fixtures. Run a selected-config Cloudflare build, then exercise that built Worker against fresh local D1 before any remote deployment. Hosted acceptance additionally requires actual signed Registry installs, anonymous admin denial, authorized admin operation, and independent exact-head review.

Private deployment configuration, logs, resource identities and current verification outcomes stay in the operator run packet. No deployment, installed plugin, merchant connection, payment, or production readiness is claimed by this source proof. The existing historical package scripts target older immutable artifacts and cannot be reused as proof of these releases. This change does not alter the separately owned Access extraction work.
