# Event-day pilot runbook

This runbook is an operating template, not an SLA. Fill in named owners, customer contacts, response targets, and approved recovery points before the first live event. Do not promise 24/7 coverage until the people and escalation path are staffed.

## Required contacts before the event

| Role | Name and monitored contact | Coverage window |
| --- | --- | --- |
| Venue incident lead | To be assigned by the customer | Event window |
| Venue Wrangler incident lead | To be assigned by the product owner | Event window |
| Identity administrator | Customer-provided contact | On call during sign-in issues |
| Database/cloud operator | To be assigned by the product owner | On call for service incidents |
| Privacy/security contact | To be assigned by both parties | Per the signed DPA |

## Pre-event readiness

1. Confirm the deployed API revision, database migration level, customer IdP issuer/audience/client mapping, and event/venue/location scopes. Do not use demo accounts for the live event.
2. Call `GET /api/health` from the approved operator network. Require HTTP 200, `ok: true`, `rlsEnforced: true`, and `databaseConnected: true`. Treat any 503 or missing protected-table check as a release stop.
3. Sign in with one least-privilege worker and one manager account. Verify each sees only its assigned event and locations; verify manager-only issue transitions and task updates are rejected for the worker account.
4. On a managed device, submit an issue with a photo, disconnect networking, confirm the encrypted report remains queued, reconnect, then verify the issue and evidence arrive and can be viewed by an authorized reader.
5. Confirm the event's support contact and fallback procedure with the venue. Keep operational incident reporting available if Venue Wrangler is unavailable; do not rely on the app as the venue's sole emergency channel.
6. Record the API health response, app build number, test account roles, and result of the evidence upload check in the event readiness record. Never include credentials or real incident content.

## Incident levels and first response

- **Critical:** suspected cross-tenant disclosure, account takeover, sensitive credential exposure, or broad outage during active event operations. Stop new releases and risky admin changes. The incident lead coordinates containment, evidence preservation, customer notification through the contracted contact, and regulatory/privacy escalation with counsel.
- **High:** one customer's sign-in or a core event workflow is unavailable, or evidence uploads are failing across devices. Confirm `/api/health`, identify affected tenant/event/build, preserve redacted logs, and route work to the named cloud or identity operator.
- **Normal:** isolated device, training, or non-blocking workflow issue. Capture app version, operating system, event, time, and steps to reproduce; avoid personal or security-sensitive content.

For every incident, record UTC start time, reporter, impact, tenants/events affected, actions and decision owners, and recovery verification. Store incident records only in the approved restricted system.

## Containment and recovery

1. Preserve a minimal timeline and relevant redacted service logs before changing state. Do not copy bearer tokens, private keys, photo contents, or customer PII into tickets.
2. For a suspected identity issue, ask the customer's identity administrator to disable or revoke the affected principal/session. Rotate a compromised application secret through its owner and redeploy using the approved secret manager. Do not paste secrets into GitHub Actions logs.
3. For a suspected bad API release, route traffic to the last known healthy Cloud Run revision using the deployment owner. Check `/api/health` and perform a scoped sign-in/read/write check before declaring recovery.
4. For suspected data loss or database damage, stop writes if needed, preserve the affected database state, and restore only through the approved backup process into an isolated recovery target first. Verify tenant RLS, row counts, migration state, audit trail, and representative issue/task/evidence metadata before customer traffic is restored.
5. Notify affected customers through the contracted channel and timing. Legal/privacy owners determine any statutory notice requirements; this runbook does not set those deadlines.
6. After recovery, reconcile queued offline reports with the server, check for duplicate or missing issue/evidence records, and document customer-approved follow-up actions.

## Release and migration gate

- Review the CI run and dependency advisory output for the exact commit.
- Apply database migrations using the approved migrator identity, after a backup and staging replay. Do not run migrations with the application runtime role.
- Verify the health endpoint reports all 16 protected tables with RLS and FORCE RLS, and the runtime role is neither superuser nor `BYPASSRLS`.
- Run tenant-isolation checks in a disposable staging database. A green compile or unit test does not prove database isolation.
- Deploy as a candidate revision with no customer traffic first. Perform health and SSO acceptance checks before shifting traffic.

## Pilot readiness records still required

The product owner and customer must agree on support coverage, SLA, incident contacts, data retention, backup frequency and recovery objectives, security questionnaire answers, DPA, insurance, and independent test evidence. Record approved values in the contract and customer operations packet; do not invent values in this template.
