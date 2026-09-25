# Venue Wrangler Enterprise — Phase 6: Architecture, offline contracts, and vertical workflows

## First implementation slice

The first delivered vertical workflow is **event issue management**:

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
| Review and finalize event closeout | `event:closeout` plus event scope; assigned follow-ups also require an active person within the manager's assignable scope |
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

## Offline policy across the current product

Offline support is defined per command rather than inferred from a screen being visible. Cached reads are never used after an authorization or server response, and every queued command remains bound to the identity and capability scope that created it.

| Workflow | Read while offline | Write while offline | Recovery and conflict rule |
|---|---|---|---|
| Sign-in and tenant bootstrap | Previously loaded bootstrap is available from the encrypted cache for up to 12 hours after transport failure. | Online-only. | Sign-in, token refresh, and a first bootstrap require the identity provider/API. Authorization failures never fall back to cached data. |
| Event issues and operations tasks | Previously loaded event issue/task lists are available from the encrypted, identity-and-capability-scoped cache for up to 12 hours after transport failure. | Issue reports and photo evidence can be queued; issue transitions and task mutations require connectivity. | Report retries retain idempotency and original session scope. Failed evidence uploads do not discard the report. Managers refresh before making online state transitions. |
| Hospitality requests and fulfillment | Previously loaded orders are available from the encrypted, identity-and-capability-scoped cache for up to 12 hours after transport failure. | Request drafts are encrypted locally and queued; kitchen preparation, distribution, pickup, rejection, and cancellation are online-only. | Queued requests retain their event and identity scope and sync when connectivity returns. Kitchen actions always require current server state. |
| Staffing schedule and worker responses | Previously loaded shifts are available from the encrypted, identity-and-capability-scoped cache for up to 12 hours after transport failure. | Shift acknowledgement, schedule edits, publication, assignment, breaks, and corrections are online-only. Attendance timestamps may be recorded as encrypted offline claims. | Offline attendance remains unverified and is not applied to the schedule until an independently scoped supervisor accepts or rejects it with a reason. |
| Inventory counts, balances, and transfers | Stock balances/counts are online-only. A previously loaded transfer queue can be read from the encrypted cache for up to 12 hours after transport failure. | Online-only. | Count approval rejects stale expected balances; transfer dispatch checks current source stock and receipt records actual quantities. Queuing these writes offline would hide conflicts and is not supported. |
| Event closeout | Online-only. The review assembles current issues, tasks, attendance claims, hospitality, and stock exceptions from the API. | Online-only, including summary and exception decisions. | The server rechecks live exceptions during finalization, stores immutable audit history, and blocks ordinary event mutations after closure. Offline closeout note capture and controlled post-close corrections remain gaps. |
| Tenant setup and roster administration | Online-only. | Online-only. | API tenant-admin capability and scoped audit are required for each write. IdP role and UUID scope changes remain managed by the customer identity administrator. |
| Notifications | The durable inbox is fetched online; configured OS push can alert while the app is backgrounded. | Mark-read and device registration/revocation are online-only. | Push is generic and non-sensitive; the tenant-scoped inbox remains the source of truth. |
| SCIM and signed vendor events | Online-only. | Online-only. | SCIM and inbound HMAC events are accepted by the API and use tenant-specific credentials, replay handling, and server audit. Vendor-specific adapters remain separate integration work. |

This policy intentionally limits offline writes to workflows with a defined encrypted outbox and conflict resolution. It does not claim that all event-day work is available without network access.

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
| `services/api/src/closeout.*` | Exception aggregation, reasoned dispositions, idempotent finalization, and audit for scoped event closeout |
| `services/api/prisma/migrations/20261016000000_event_closeout` | Tenant-protected event closeout records, follow-ups, immutable audit, and closed-event write guards |
| `docs/integrations/signed-event-ingestion.md` | Canonical adapter event envelope, signature format, retry contract, and data-minimization guidance |
| `docs/product/phase-6-architecture.md` | Architecture decisions and operation boundaries |

## Verification status

- Previous automated evidence: GitHub Actions CI run [36122600658](https://github.com/lwhobley/venuewranglerenterprise/actions/runs/36122600658) passed Flutter analysis/tests, API build/tests, Prisma validation/client generation, the migration replay under the non-superuser migrator, and runtime tenant-isolation checks under `venue_app`. That run covered 40 protected tables and event closeout isolation/write locks. Vendor staffing adds two health-gated protected tables (42 total); its migration and runtime isolation still require CI and staging verification before deployment.
- The JWT guard tests generate temporary RS256 keys and exercise OIDC discovery/JWKS, issuer/audience/client verification, expiration, UUID scope claims, provider-derived tenant selection, and deactivated-user denial for Okta and Entra configurations. These protocol tests do not substitute for a login against a customer's registered IdP tenant.
- Earlier physical Android issue-report recovery validation is historical evidence for that build only. Re-run intermittent-network, accessibility, performance, and end-to-end workflow checks on the current release candidate and approved customer staging before pilot.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout.
- Android device verification: on a FOXXD HTH C67 running Android 14, an issue report was saved while Wi-Fi and mobile data were disabled, survived force-stop/relaunch in encrypted storage, and remained queued after mobile data returned. The app now has organization-scoped Okta/Entra OIDC discovery and native PKCE sign-in, but no customer provider registration has been supplied; real login and server acceptance remain unverified. The header shows the queued/blocked count, and the mobile Event Command issue detail scrolls without a flex-layout assertion.
- Automated Flutter coverage checks report-form labels, keyboard focus from title to location, live-region issue status, and a 200% text scale layout. Android UI hierarchy exposed the location control and submit action. Database polling is the current event transport, with broker-backed fan-out a future scale-up option.

The issue outbox provides durable local issue submission, encrypted photo evidence, session-bound replay, startup/connectivity-triggered retry, visible failed state, and manual retry. The app also keeps a short-lived encrypted cache of the organization bootstrap and previously loaded event issue/task lists for transport outages. These architecture notes describe repository behavior; they do not establish customer IdP acceptance, current production deployment state, or compliance certification.
