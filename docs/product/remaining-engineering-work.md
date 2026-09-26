# Remaining engineering work

Repository engineering that can be completed without a customer environment is done through commit `a2a1a01` plus the venue-notice and vendor-deadline work that follows it. Passing CI is not a pilot. The items below require a customer, an operator, legal, or an independent assessor.

## Finished in the repository

- Tenant and venue administration, including signed `venue:admin` scope, departments, service areas, templates, and venue-clock event times.
- Venue activation notifies people explicitly assigned as notice recipients. It does not infer administrators from identity-provider groups.
- Source-agnostic ingestion, identifier correction, field ownership, polling checkpoints, and dead-letter review. No named vendor is connected.
- Desktop schedule grid, saved views, bulk actions, keyboard focus, and overlap labels. Suggestions stay reviewable. The product does not automatically assign or publish shifts.
- Overdue vendor requests can be escalated by an operations manager. Escalation records the missed deadline and notifies the requester. It does not fill the gap or verify attendance.

## External gates still required

- Customer Okta or Entra app registration, claim mapping, and a successful login in that tenant.
- Approved API deployment, HTTPS origin, staging migration, and staging tenant-isolation check.
- Private evidence storage, Firebase/APNs push on physical devices, SCIM credentials, and managed-device distribution.
- Vendor API specifications, credentials, sample payloads, and acceptance cases before any labor, POS, or ticketing adapter is written.
- A pilot-venue decision before any automatic assignment or optimization is added.
- Penetration test, SOC 2 or questionnaire evidence, DPA, insurance, SLA, backup restore evidence, and staffed event-day support.
