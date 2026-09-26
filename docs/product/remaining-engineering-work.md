# Remaining engineering work

This list tracks repository work needed before a customer pilot. Code completed locally still needs migration replay, CI, staging, and customer acceptance before it can be called ready.

## 1. Finish tenant and venue administration

- Verify the new `venue:admin` authorization matrix against assigned and unassigned venues, including replayed idempotency keys and bootstrap visibility. Confirm IdP claim mapping with a customer tenant. The API and Flutter changes are local only.
- Venue departments, service areas, location assignment, onboarding checklist, and versioned templates with preview and additive apply are implemented locally. They still need migration replay, CI, and a customer IdP claim check.

## 2. Build a source-agnostic aggregation platform

- Keep one normalized, signed ingestion contract for all external systems. The existing endpoint handles event records and task snapshots; the new source-specific venue, event, and location identifier mappings are local and unverified against a database.
- Add a tenant admin configuration screen for sources, mapping review, and dry-run sample payload validation. Store credentials only in the approved secret store; expose only credential status and rotation metadata to the app.
- Generic webhook ingestion remains the signed `/integrations/events` and `/integrations/raw` endpoints. A configured HTTPS poll URL can be pulled by a tenant administrator, with a stored cursor, a minimum interval, page limits, rate-limit deferral, and dead-letter review/replay. This does not connect a named vendor until that vendor's API specification, credential, sample payload, and acceptance case exist.
- Versioned field transforms and audited identifier correction with impact preview are implemented locally. Ownership rules for labor, POS, ticketing, and inventory still need a customer decision before a live adapter writes those fields.
- Implement customer-specific adapters only after obtaining API specifications, credentials, sample data, allowed data fields, and acceptance cases. A generic ingestion API alone cannot connect to every vendor protocol.

## 3. Complete planning and staffing at desktop scale

- The desktop schedule grid, saved views, and bulk publish/cancel/assign/move actions are implemented locally. A repeated bulk key now conflicts if the payload changes and replays the stored result when it matches. Keyboard access, customer acceptance, and CI for the new migrations are still open.
- Decide with the pilot venue whether automatic assignment or optimization is required. Keep suggestions reviewable and recheck all labor rules at write time.

## 4. Prove the release and customer environment

- Replay the new migration from a clean database, run runtime-role isolation checks, and get CI green for the exact commit. Apply migrations to approved staging before customer data.
- Deploy the API behind a verified HTTPS origin; prove Okta or Entra sign-in, claim scoping, SCIM lifecycle, private evidence storage, device push, managed distribution, and backup restore in the customer's staging environment.
- Run a full event-day rehearsal with real venue data, staff roles, offline devices, connector failures, support escalation, and closeout. Record customer acceptance criteria and any gaps.

Security assessment, legal agreements, insurance, SLA, and staffed event-day support also remain pilot gates, but require customer and business decisions beyond repository code.
