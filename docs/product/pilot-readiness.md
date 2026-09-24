# Pilot readiness: implemented product slice and remaining dependencies

This checklist separates code in the repository from controls that require a customer environment, independent assessment, or service operations. A successful compile does not mean the product is production-certified or that a customer's SSO works.

## Repository work completed in this slice

- Tenant admin APIs provision organizations from the verified issuer-to-tenant mapping and create venues, locations, events, and people. Requests cannot select an organization ID.
- `tenant:admin` gates tenant setup on the API. `operations:read` and `operations:write` gate event task access alongside signed venue/event/location scopes.
- Plan, Staffing, Service, and Stock task records have tenant/event/location consistency constraints, row-level security, and append-only audit events.
- The signed-in Flutter experience now loads its organization and event data from `/api/v1/me`, uses the real issue list and task endpoints, replaces the client-side role picker with IdP capabilities, and exposes the admin setup flow.
- Issue triage, assignment, escalation, resolution, verification, and closure invoke the existing audited, idempotent API transitions. Pending or failed offline issue reports are visible in a per-event queue and can be retried.
- Issue assignment and resolution create durable in-app notifications in the same transaction as the issue transition. Notification reads are restricted to the verified recipient subject by PostgreSQL RLS; users can mark their own notifications read in the app.
- Issue reports support up to five encrypted-at-rest local photo attachments. The API creates private Cloud Storage uploads with short-lived signed URLs, verifies content type, byte count, and SHA-256 before marking an attachment ready, and returns short-lived signed download links to authorized issue readers.
- Offline issue reporting uses the encrypted secure-storage outbox and retries when connectivity returns. Previously loaded organization/event bootstrap, issue, and task lists are cached in secure storage per signed-in identity and capability scope for up to 12 hours; cache reads are used only for transport failures, not authorization/server responses. Pending reports are bound to their originating session scope and cannot be replayed under a different login.
- iOS release workflow requires the repository variable `VENUE_API_BASE_URL`, rejects a non-HTTPS value, and passes the selected URL as a Dart define. It fails closed when the value is missing.

## Required before a customer pilot

1. **Choose and deploy the API.** Set GitHub Actions variable `VENUE_API_BASE_URL` to the actual HTTPS API origin after deploying the API. The repository does not contain a verified current API URL; do not use a guessed `run.app` name.
2. **Apply the database migration through the approved migrator process.** This repository adds `20260926000000_operations_admin`; it has not been applied to a database by this change. Confirm the target project and migration identity before rollout.
3. **Configure customer Okta/Entra apps and claims.** Provision `SSO_PROVIDERS_JSON`; map least-privilege IdP roles to `issue:*`, `operations:*`, and narrowly assigned `tenant:admin`, plus current UUID scopes and assignable user subjects. Test token audience, client, issuer, group mapping, revocation, and successful API acceptance in each customer tenant.
4. **Onboard and scope the tenant.** An authorized administrator can create venue structure. An identity administrator still needs to assign the corresponding venue/event/location IDs and capabilities to user tokens.
5. **Configure and verify evidence storage.** Set production `EVIDENCE_BUCKET` to a private Cloud Storage bucket. Enable uniform bucket-level access and public access prevention; use a dedicated Cloud Run service identity with object create/read permissions and IAM signing permission for V4 upload policies, with no service-account key file. Apply the database migrations, configure allowed origins if Flutter web uploads are supported, and validate upload/download lifecycle in staging. APNs/FCM push delivery, SCIM lifecycle provisioning, labor/POS/ticketing adapters, and MDM/Intune distribution remain unimplemented.
6. **Complete customer security and operations review.** SOC 2 evidence, independent penetration testing, DPA, insurance, SLA, incident response, monitoring, backups/restore evidence, and event-day support commitments must be supplied and approved; this repository does not create those attestations or commitments.

## Release verification still required

- No migration, deployment, authenticated customer IdP login, Cloud Storage validation, App Store Connect upload, or device validation was performed as part of this change.
- Run the existing tenant-isolation/security verification suite after applying the migration in a disposable staging database, and verify the `tenant:admin` and task authorization matrix before exposing these endpoints to a customer.
