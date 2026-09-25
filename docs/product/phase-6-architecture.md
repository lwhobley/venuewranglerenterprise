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
  ├─ replayable, authorized SSE issue updates with automatic reconnect
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

Issue photo evidence is implemented as encrypted local capture plus direct, short-lived signed uploads to a private Cloud Storage bucket. Deployment must provision and secure that bucket and grant the API's Cloud Run service identity the required object and signing permissions. The app now has an opt-in FCM/APNs push path; issue notifications are persisted in the inbox first and sent after commit with generic, non-sensitive alert text. Firebase/APNs project configuration and device delivery acceptance still require external setup.

The app keeps a twelve-hour, identity-and-capability-scoped encrypted cache of the signed-in bootstrap and event issue/task lists for transport outages. It does not allow cached data after an API authorization or server response, and pending issue reports retain the original session scope so they are never replayed under a different account.

## Authorization model

The access token supplies a subject, organization tenant, roles, and explicitly allowed venue/event/location identifiers. Authentication fails closed when any required claim is absent. Authorization is evaluated on the API before every command and RLS applies the tenant boundary in PostgreSQL as defense in depth.

| Action | Required capability |
|---|---|
| Create issue | `issue:report` plus event and venue scope |
| View event issues / stream | `issue:read` plus event scope |
| Assign or triage | `issue:triage` plus event scope |
| Escalate | `issue:escalate` plus event scope |
| Resolve or verify | `issue:resolve` or `issue:verify` plus event scope |
| Read operational tasks | `operations:read` plus event scope |
| Create or update operational tasks | `operations:write` plus event, venue, location, and assignee scope |
| Configure tenant venues, events, locations, and people | `tenant:admin` |

The server never accepts a tenant identifier from a request body. It derives tenant scope from the verified token and uses the same identity inside the database transaction.

## Data and command rules

- Each mutation requires an `Idempotency-Key`; a repeated key returns the original command response.
- Tenant setup writes (venue, location, event, and person provisioning) and operational task create/update use tenant-scoped command receipts. The Flutter client persists each pending key in secure storage under a hash of the command plus the current identity/capability scope, so a retry after a transport failure replays the original response rather than duplicating the write. Reusing a key with a different actor, command, or payload is rejected.
- Organization bootstrap and setup-resource creation append actor, action, resource type/ID, event reference where applicable, and changed field names to an RLS-protected immutable audit table. The audit feed never exposes stored record payloads.
- The API writes the business change, immutable audit event, command receipt, and realtime event inside one database transaction.
- Issue activity captures actor, transition, before/after values, and optional reason. Database triggers prevent edits or deletion of audit rows.
- Every event query and command sets `app.tenant_id` transaction-locally before using Prisma. RLS policies use this setting.
- Issue updates use explicit transition commands rather than an unrestricted `PATCH` of arbitrary state.

## Offline behavior for issue reporting

| Operation | Policy | Recovery |
|---|---|---|
| Read previously loaded permitted data | Offline-capable | The app keeps a short-lived encrypted cache of the organization bootstrap and event issue/task lists, scoped to the signed-in identity and capability scope. |
| Report issue | Offline-writable | Encrypt/store command and idempotency key in secure storage; show pending state; retry on startup and when connectivity returns. Failed API requests remain queued and can be retried manually. |
| Attach evidence | Offline-writable | Queue upload separately; preserve report even if upload fails. |
| Assign/escalate/resolve/verify | Online-only initially | Present current state requirement, retain draft update, and retry only after refresh. |

An outbox item never disappears on retry failure. The user may edit before sending, retry, or discard only if the command has not been accepted by the server.

## Delivery topology

The API is containerized and stateless. Issue changes and their `issue_events` records commit together. SSE instances poll the shared, tenant-protected PostgreSQL event log and support `Last-Event-ID` replay, so a report written through one instance can be delivered through another. This first durable adapter uses database polling; production can replace polling with a broker while preserving the event log and cursor contract.

Health checks fail closed for missing JWT verification configuration, database connectivity, or disabled tenant enforcement. Runtime database credentials use a non-superuser `NOBYPASSRLS` role; migrations use a distinct migrator role.

## Observability

- Every completed HTTP request emits one JSON stdout log with a validated/generated correlation ID, route template, method, status class, duration, and (after authentication) a truncated SHA-256 tenant hash. Request bodies, query strings, tokens, user identifiers, and raw tenant IDs are never logged.
- OpenTelemetry HTTP and Express spans plus request count and duration metrics are enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` points to an OTLP/HTTP collector. Export is optional for local development. Configure collector access/networking separately; the API exporter does not attach cloud credentials, and collector credentials must not be put in the endpoint URL. Without an endpoint, structured request logs still work, but metrics and traces are not exported.
- Metrics currently cover HTTP request count and duration with bounded method, route-template, and status-class attributes. Domain command outcomes, replay counts, authorization failures, sync retry counts, and SSE delivery lag remain future instrumentation work; no claim is made that those signals are currently emitted.
- API request traces are produced by HTTP and Express instrumentation. Cross-service mobile, database transaction, durable event, and notification spans are not yet connected end to end.

## Implementation artifact map

| Artifact | Purpose |
|---|---|
| `services/api` | NestJS API, auth guard, issue commands, SSE development adapter, tests |
| `services/api/prisma` | Domain schema, tenant RLS, locations, and durable issue-event migrations |
| `services/api/test/tenant-isolation.mjs` | Runtime-role two-tenant RLS and location-boundary verification |
| `prototype/venue_wrangler_prototype/lib/features/issues` | Encrypted outbox, connectivity-triggered retry, REST client, and Riverpod controller |
| `prototype/venue_wrangler_prototype/lib/features/operations` | API client and live organization, event, issue, and task data providers |
| `services/api/src/operations.*` | Tenant bootstrap, administrator onboarding, operational task CRUD, and audit records |
| `services/api/src/scim.*` | Tenant-bound SCIM 2.0 user lifecycle and immediate API denial for deactivated provisioned users |
| `services/api/src/integration.*` | HMAC-authenticated, idempotent normalized event ingestion for vendor-specific adapters |
| `services/api/prisma/migrations/20260926000000_operations_admin` | Tenant people and operational-task tables with RLS and consistency constraints |
| `docs/integrations/signed-event-ingestion.md` | Canonical adapter event envelope, signature format, retry contract, and data-minimization guidance |
| `docs/product/phase-6-architecture.md` | Architecture decisions and operation boundaries |

## Verification status

- Verified locally: API type-check/build and state-machine unit tests; Docker Compose migrations and health gate; runtime-role two-tenant isolation across all eight protected tables; same-tenant wrong-venue and cross-tenant location rejection; full issue lifecycle and SSE replay through a second API instance; Flutter controller/widget tests, analyzer, and web build.
- SCIM, append-only roster audit, provisioning deactivation checks, signed integration ingestion, and normalized task upserts were added after that earlier verification. CI applies every migration to a clean PostgreSQL 17 database as the non-superuser migrator and runs the tenant-isolation suite as the non-superuser runtime role; the actual customer staging database and its identity-provider path still require independent rollout verification.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout.
- Android device verification: on a FOXXD HTH C67 running Android 14, an issue report was saved while Wi-Fi and mobile data were disabled, survived force-stop/relaunch in encrypted storage, and remained queued after mobile data returned. The app now has organization-scoped Okta/Entra OIDC discovery and native PKCE sign-in, but no customer provider registration has been supplied; real login and server acceptance remain unverified. The header shows the queued/blocked count, and the mobile Event Command issue detail scrolls without a flex-layout assertion.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout. Android UI hierarchy exposed the location control and submit action. Database polling is the current event transport, with broker-backed fan-out a future scale-up option.

The issue outbox provides durable local issue submission, encrypted photo evidence, session-bound replay, startup/connectivity-triggered retry, visible failed state, and manual retry. The app also keeps a short-lived encrypted cache of the organization bootstrap and previously loaded event issue/task lists for transport outages. These architecture notes describe repository behavior; they do not establish customer IdP acceptance, current production deployment state, or compliance certification.
