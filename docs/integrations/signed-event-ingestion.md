# Signed integration event ingestion

`POST /api/v1/integrations/events` is the provider-neutral ingestion seam for labor, POS, ticketing, and inventory adapters. It stores a normalized event envelope in the tenant-scoped event ledger. It does not call a vendor API, create or alter operational tasks, or replace any system of record; each customer/vendor still needs an adapter and agreed field mapping.

## Configure a source

Store `INTEGRATION_PROVIDERS_JSON` in Google Secret Manager and pin the version in the production GitHub environment variables. Example shape:

```json
[
  {
    "id": "arena-labor",
    "organizationSlug": "harbor-city-events",
    "tenantId": "00000000-0000-4000-8000-000000000001",
    "secret": "<unique-random-secret-of-at-least-32-characters>"
  }
]
```

Use a different random secret for every integration. Rotate by creating a new pinned Secret Manager version and coordinating the sender before disabling the old credential. `id` is recorded as the event source. An integration ID maps to one tenant and cannot choose a tenant in the request.

## Request signature

Send `Content-Type: application/json` and these headers:

- `X-Integration-Id`: configured integration ID.
- `X-Integration-Timestamp`: current Unix timestamp in whole seconds.
- `X-Integration-Signature`: lowercase or uppercase hex HMAC-SHA256 of the exact raw request bytes prefixed with `timestamp + "."`.

The API accepts timestamps within five minutes and compares signatures in constant time. Sign the exact UTF-8 body bytes; whitespace/key-order changes after signing invalidate the request. Requests are limited to 64 KiB.

## Canonical event

```json
{
  "venueEventId": "20000000-0000-4000-8000-000000000001",
  "externalId": "vendor-record-2026-09-24-001",
  "eventType": "labor.shift.updated",
  "occurredAt": "2026-09-24T18:30:00Z",
  "payload": {
    "externalVenueId": "arena-17",
    "department": "guest-services",
    "status": "filled"
  }
}
```

Map the external event/venue to the canonical Venue Wrangler event UUID before sending. `externalId` is stable per source and idempotent per tenant. Retrying the same exact payload returns the existing ledger record; reusing the ID for different bytes returns a conflict. Use a fresh timestamp and signature for retries. `GET /api/v1/integrations/events/:eventId` uses the signed-in user's bearer token and requires `operations:read` plus event scope.

Do not send payment card data, authentication secrets, or unnecessary guest/employee personal data in `payload`. Define the approved field mapping and retention period with the venue before enabling a source.
