# Signed integration event ingestion

`POST /api/v1/integrations/events` is the provider-neutral ingestion seam for labor, POS, ticketing, and inventory adapters. It stores a normalized event envelope in the tenant-scoped event ledger. `operations.task.upserted` also creates or updates an API-backed task for use in Plan, Staffing, Service, or Stock. It does not call a vendor API or replace any system of record; each customer/vendor still needs an adapter and agreed field mapping.

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

## Create or refresh an operational task

For task-shaped updates, send `eventType: "operations.task.upserted"` and use a new event-level `externalId` for each source update. The payload is a normalized snapshot:

```json
{
  "externalTaskId": "ukg-shift-88421",
  "kind": "STAFFING",
  "title": "Fill guest services shift",
  "description": "Gate 4, event staffing plan",
  "locationId": "30000000-0000-4000-8000-000000000001",
  "dueAt": "2026-09-24T18:00:00Z",
  "expectedQuantity": 12,
  "unit": "staff"
}
```

`externalTaskId` is the stable vendor task key; it must be unique within the configured source and tenant. Supported `kind` values are `PLAN`, `STAFFING`, `SERVICE`, and `STOCK`. A new task starts `OPEN`. Refreshes can change source-owned descriptive, timing, quantity, and location fields, but keep the existing workflow state and assignee under venue control. Only an existing task created by that same integration source can be refreshed; a source cannot claim a human-created task or move its task to another event. Locations must belong to the mapped event's venue. Every import creates an append-only operational-task audit record under the integration identity in the same database transaction as the event ledger write.

This is a normalized adapter contract, not a ready-made UKG, POS, inventory, or ticketing connector. Build and validate the vendor-specific authentication, polling/webhook handling, ID mapping, and field mapping before enabling a source in a customer tenant.

Do not send payment card data, authentication secrets, or unnecessary guest/employee personal data in `payload`. Define the approved field mapping and retention period with the venue before enabling a source.
