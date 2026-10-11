# Payment receipt handoff

The success page consumes a server-to-server Payments receipt lookup. Payments
must expose:

```text
GET {PAYMENTS_BASE_URL}/v1/checkout/receipt?session_id={session_id}
Authorization: Bearer {PAYMENTS_STORE_KEY}
Accept: application/json
```

`PAYMENTS_BASE_URL` and `PAYMENTS_STORE_KEY` are server-only bindings. The
store key must never be serialized into HTML, browser JavaScript, or a link.
The `session_id` comes from the provider redirect query and is only a locator;
Payments must verify its ownership for the configured store before returning a
receipt.

Paid responses use this exact JSON shape:

```json
{
  "orderNumber": 1001,
  "test": true,
  "status": "paid",
  "items": [
    { "name": "Everyday Tee", "variant": "M", "quantity": 1, "unitCents": 2400, "totalCents": 2400 }
  ],
  "subtotalCents": 2400,
  "shippingCents": 500,
  "taxCents": 0,
  "totalCents": 2900,
  "currency": "USD",
  "shipTo": {
    "name": "Test Shopper",
    "line1": "1 Example Way",
    "line2": "Apt 2",
    "city": "Testville",
    "state": "CA",
    "postalCode": "00000",
    "country": "US"
  },
  "email": "shopper@example.test"
}
```

Pending responses may return HTTP `202` or JSON with `"status": "pending"`.
Missing, invalid, failed, unauthorized, and unavailable lookups are rendered
as the same friendly not-found state; the storefront never treats a query
parameter, browser storage value, or client total as payment authority.
