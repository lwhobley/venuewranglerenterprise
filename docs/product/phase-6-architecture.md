# Venue Wrangler Enterprise — Phase 6: Architecture and first vertical workflow

## First implementation slice

The first vertical workflow is **event issue management**:

`Report → triage → assign → escalate → resolve → verify/close`

It was selected because it is used by frontline workers and managers during live events, and it proves the core product contracts before implementing other domains: event context, role/scope authorization, command idempotency, immutable audit, real-time fan-out, offline submission, ownership, and recovery.

## System boundaries

```text
Flutter app
  ├─ feature UI and Riverpod controllers
  ├─ REST issue reporting with connectivity-aware retry
  └─ encrypted secure-storage outbox for issue reports
             │
             ▼
NestJS API (/api/v1)
  ├─ JWT identity and scoped authorization
  ├─ idempotent issue commands
  ├─ issue read model and replayable SSE issue stream
  └─ transactional audit and durable event publishing
             │
             ▼
PostgreSQL
  ├─ system of record
  ├─ RLS tenant boundary using transaction-local tenant context
  ├─ immutable audit rows
  └─ command receipts for idempotency
```

Object storage holds issue media using pre-authorized, tenant-scoped upload commands; it is deliberately outside this initial text-only issue slice. Background jobs deliver retries and non-urgent notifications from durable events rather than directly from request handlers.

## Authorization model

The access token supplies a subject, organization tenant, roles, and explicitly allowed venue/event/location identifiers. Authentication fails closed when any required claim is absent. Authorization is evaluated on the API before every command and RLS applies the tenant boundary in PostgreSQL as defense in depth.

| Action | Required capability |
|---|---|
| Create issue | `issue:report` plus event and venue scope |
| View event issues / stream | `issue:read` plus event scope |
| Assign or triage | `issue:triage` plus event scope |
| Escalate | `issue:escalate` plus event scope |
| Resolve or verify | `issue:resolve` or `issue:verify` plus event scope |

The server never accepts a tenant identifier from a request body. It derives tenant scope from the verified token and uses the same identity inside the database transaction.

## Data and command rules

- Each mutation requires an `Idempotency-Key`; a repeated key returns the original command response.
- The API writes the business change, immutable audit event, command receipt, and realtime event inside one database transaction.
- Issue activity captures actor, transition, before/after values, and optional reason. Database triggers prevent edits or deletion of audit rows.
- Every event query and command sets `app.tenant_id` transaction-locally before using Prisma. RLS policies use this setting.
- Issue updates use explicit transition commands rather than an unrestricted `PATCH` of arbitrary state.

## Offline behavior for issue reporting

| Operation | Policy | Recovery |
|---|---|---|
| Read cached permitted issues | Planned | The current slice does not cache server read models. |
| Report issue | Offline-writable | Encrypt/store command and idempotency key in secure storage; show pending state; retry on startup and when connectivity returns. Failed API requests remain queued and can be retried manually. |
| Attach evidence | Offline-writable | Queue upload separately; preserve report even if upload fails. |
| Assign/escalate/resolve/verify | Online-only initially | Present current state requirement, retain draft update, and retry only after refresh. |

An outbox item never disappears on retry failure. The user may edit before sending, retry, or discard only if the command has not been accepted by the server.

## Delivery topology

The API is containerized and stateless. Issue changes and their `issue_events` records commit together. SSE instances poll the shared, tenant-protected PostgreSQL event log and support `Last-Event-ID` replay, so a report written through one instance can be delivered through another. This first durable adapter uses database polling; production can replace polling with a broker while preserving the event log and cursor contract.

Health checks fail closed for missing JWT verification configuration, database connectivity, or disabled tenant enforcement. Runtime database credentials use a non-superuser `NOBYPASSRLS` role; migrations use a distinct migrator role.

## Observability

- Every request logs a correlation ID, tenant hash, event ID, command name, outcome, and latency; raw descriptions and tokens are excluded.
- Metrics track command success/failure/idempotent replay, stale-client conflicts, sync retries, authorization failures, and event-stream delivery lag.
- Traces connect mobile command, API command, database transaction, durable event, and notification delivery.

## Implementation artifact map

| Artifact | Purpose |
|---|---|
| `services/api` | NestJS API, auth guard, issue commands, SSE development adapter, tests |
| `services/api/prisma` | Domain schema, tenant RLS, locations, and durable issue-event migrations |
| `services/api/test/tenant-isolation.mjs` | Runtime-role two-tenant RLS and location-boundary verification |
| `prototype/venue_wrangler_prototype/lib/features/issues` | Encrypted outbox, connectivity-triggered retry, REST client, and Riverpod controller |
| `docs/product/phase-6-architecture.md` | Architecture decisions and operation boundaries |

## Verification status

- Verified locally: API type-check/build and state-machine unit tests; Docker Compose migrations and health gate; runtime-role two-tenant isolation across all eight protected tables; same-tenant wrong-venue and cross-tenant location rejection; full issue lifecycle and SSE replay through a second API instance; Flutter controller/widget tests, analyzer, and web build.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout.
- Android device verification: on a FOXXD HTH C67 running Android 14, an issue report was saved while Wi-Fi and mobile data were disabled, survived force-stop/relaunch in encrypted storage, and remained queued after mobile data returned. The app now has organization-scoped Okta/Entra OIDC discovery and native PKCE sign-in, but no customer provider registration has been supplied; real login and server acceptance remain unverified. The header shows the queued/blocked count, and the mobile Event Command issue detail scrolls without a flex-layout assertion.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout. Android UI hierarchy exposed the location control and submit action. Database polling is the current event transport, with broker-backed fan-out a future scale-up option.

The current outbox provides durable local issue submission, startup/connectivity-triggered retry, visible failed state, and manual retry. A local cached read model remains follow-up work.
