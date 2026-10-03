# Next prerequisite for TEST checkout

This source adapter is not a checkout enable switch. The hosted demo continues
to browse and manage a guest cart until its installed Commerce runtime can
receive the trusted payment host and expose its canonical checkout storage to
one scheduler through a supported EmDash 1.0.1 context.

## Minimal owner handoff

Supply one attested installed-runtime assembly for the exact Commerce artifact:

1. The installed Commerce identity, native or Registry/sandbox route authority,
   and its checkout carts, capabilities and payment-association storage context.
2. A trusted server configuration containing `paymentsOrigin`, `siteId`,
   `commerceOrigin`, `bindingRef`, `providerId: "stripe"`, `stripeAccountId`,
   `credentialResolver`, and scoped `fetch` (optional wake limit 1..100).
3. The matching authenticated TEST Payments service, account/merchant/site tuple
   and approved credential consumer/egress. Owner transport must attest the JWT
   issuer/audience/site scope and TEST Stripe account without exposing secrets.
4. One authorized scheduler receiving that same admitted checkout context.

Descriptor JSON strips functional callbacks. EmDash has plugin cron contexts,
but no installed checkout host/storage injection has been proved here. Passing
arbitrary SQL, an invented unauthenticated route or an unrelated execution
resolver does not satisfy this gate. Native registration and source aliases
remain distinct from a Registry install. No new environment token variable or
cron recipe is supplied as a substitute for this runtime handoff.

## After admission

Use the existing configured Stripe TEST account and an explicit synthetic test
identity. Verify authoritative totals and the original frozen request/session,
then a real TEST guest payment, storefront confirmation and exactly one durable
Commerce order. Retry, cancellation/failure and closed-tab recovery must use
that same canonical state. Unknown outcomes never prove unpaid or release stock.
Inventory remains off the critical path. No customer notifications or fulfillment.

Source review, merge, package/Registry publication, credential provisioning,
service or demo deployment each retain their applicable approval gate. Existing
specific TEST-call authority applies only after the exact configured tuple and
runtime are attested. These fixtures and a Stripe dashboard signup do not meet
purchase acceptance.
