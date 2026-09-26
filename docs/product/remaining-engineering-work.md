# Remaining engineering work

This list tracks repository work needed before a customer pilot. Code completed locally still needs migration replay, CI, staging, and customer acceptance before it can be called ready.

## 1. Finish tenant and venue administration

- `venue:admin` is limited to signed venue IDs. Unit tests cover assigned updates, unassigned rejection, idempotency replay, and bootstrap visibility. Customer IdP claim mapping is still an external check.
- Departments, service areas, templates, the schedule grid, and generic integration transport are in commit `bf3095b`. CI run 36256493458 replayed those migrations and passed tenant isolation. Staging and customer acceptance remain open.

## 2. Build a source-agnostic aggregation platform

- Keep one normalized, signed ingestion contract for all external systems. The existing endpoint handles event records and task snapshots; the new source-specific venue, event, and location identifier mappings are local and unverified against a database.
- Add a tenant admin configuration screen for sources, mapping review, and dry-run sample payload validation. Store credentials only in the approved secret store; expose only credential status and rotation metadata to the app.
- Generic webhook ingestion remains the signed `/integrations/events` and `/integrations/raw` endpoints. A configured HTTPS poll URL can be pulled by a tenant administrator, with a stored cursor, a minimum interval, page limits, rate-limit deferral, and dead-letter review/replay. This does not connect a named vendor until that vendor's API specification, credential, sample payload, and acceptance case exist.
- A tenant administrator can assign one source as the owner of LABOR, POS, TICKETING, INVENTORY, or EVENT fields. Ingestion and preview reject a different source. Until an owner is configured, existing sources are not blocked. The customer still chooses the owner; this does not connect a named vendor.
- Implement customer-specific adapters only after obtaining API specifications, credentials, sample data, allowed data fields, and acceptance cases. A generic ingestion API alone cannot connect to every vendor protocol.

## 3. Complete planning and staffing at desktop scale

- The desktop schedule grid supports arrow-key focus and space to select. Saved views and bulk actions are in the same commit as the CI run above. Customer acceptance of the grid remains open.
- Decide with the pilot venue whether automatic assignment or optimization is required. Keep suggestions reviewable and recheck all labor rules at write time.

## 4. Prove the release and customer environment

- Replay the new migration from a clean database, run runtime-role isolation checks, and get CI green for the exact commit. Apply migrations to approved staging before customer data.
- Deploy the API behind a verified HTTPS origin; prove Okta or Entra sign-in, claim scoping, SCIM lifecycle, private evidence storage, device push, managed distribution, and backup restore in the customer's staging environment.
- Run a full event-day rehearsal with real venue data, staff roles, offline devices, connector failures, support escalation, and closeout. Record customer acceptance criteria and any gaps.

Security assessment, legal agreements, insurance, SLA, and staffed event-day support also remain pilot gates, but require customer and business decisions beyond repository code.
