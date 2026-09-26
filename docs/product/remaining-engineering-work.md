# Remaining engineering work

This list tracks repository work needed before a customer pilot. Code completed locally still needs migration replay, CI, staging, and customer acceptance before it can be called ready.

## 1. Finish tenant and venue administration

- Verify the new `venue:admin` authorization matrix against assigned and unassigned venues, including replayed idempotency keys and bootstrap visibility. Confirm IdP claim mapping with a customer tenant. The API and Flutter changes are local only.
- Add reusable venue templates and a versioned apply flow for common locations, departments, service areas, and event defaults. Applying a template must preview changes and avoid overwriting live event data.
- Model service areas and departments as tenant- and venue-scoped records, then use them consistently in staffing demand, issues, stock, hospitality, and permissions.
- Add a guided onboarding flow that validates venue time zone, service areas, location structure, IdP scopes, and at least one sample event before activation.

## 2. Build a source-agnostic aggregation platform

- Keep one normalized, signed ingestion contract for all external systems. The existing endpoint handles event records and task snapshots; the new source-specific venue, event, and location identifier mappings are local and unverified against a database.
- Add a tenant admin configuration screen for sources, mapping review, and dry-run sample payload validation. Store credentials only in the approved secret store; expose only credential status and rotation metadata to the app.
- Build connector workers that can receive webhooks or poll vendor APIs, then transform each source into the normalized contract. Support pagination, cursor checkpoints, rate limits, signature validation, retry with backoff, dead-letter review, replay, and source health reporting.
- Version field mappings and ownership rules per source. Define which system owns labor, POS, ticketing, inventory, and event fields, and reject ambiguous or incompatible changes before they reach operational records.
- Add controlled identifier correction with an audit trail and impact preview. An existing external identifier is intentionally write-once today to prevent silent rerouting.
- Implement customer-specific adapters only after obtaining API specifications, credentials, sample data, allowed data fields, and acceptance cases. A generic ingestion API alone cannot connect to every vendor protocol.

## 3. Complete planning and staffing at desktop scale

- Build an API-backed schedule grid spanning venue, event, day, role, area, and worker, with keyboard access and conflict indicators.
- Persist named saved views per user and shared views per venue; enforce tenant and venue scope server-side.
- Add bulk publish, cancel, assign, and move actions with per-item results, conflict previews, idempotency, audit, and partial-failure recovery.
- Decide with the pilot venue whether automatic assignment or optimization is required. Keep suggestions reviewable and recheck all labor rules at write time.

## 4. Prove the release and customer environment

- Replay the new migration from a clean database, run runtime-role isolation checks, and get CI green for the exact commit. Apply migrations to approved staging before customer data.
- Deploy the API behind a verified HTTPS origin; prove Okta or Entra sign-in, claim scoping, SCIM lifecycle, private evidence storage, device push, managed distribution, and backup restore in the customer's staging environment.
- Run a full event-day rehearsal with real venue data, staff roles, offline devices, connector failures, support escalation, and closeout. Record customer acceptance criteria and any gaps.

Security assessment, legal agreements, insurance, SLA, and staffed event-day support also remain pilot gates, but require customer and business decisions beyond repository code.
