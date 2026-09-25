# Limited pilot support agreement worksheet

This worksheet is for the product owner and venue to complete before a pilot. It is not an SLA or legal agreement until reviewed and accepted by both parties. Blank fields mean the support commitment is not established. Do not promise coverage that is not staffed.

## Parties and pilot scope

- Product/service legal entity: `[legal name]`
- Venue/customer legal entity: `[legal name]`
- Pilot venues, events, and users: `[IDs or scope]`
- Pilot start and end dates: `[dates and time zone]`
- Included workflows and devices: `[explicit list]`
- Excluded workflows and systems: `[explicit list]`
- Production or staging environment: `[environment and verified API origin]`

## Contacts and coverage

| Responsibility | Named primary and backup | Monitored channel | Coverage window and time zone |
| --- | --- | --- | --- |
| Venue event incident lead | `[name / backup]` | `[phone or approved channel]` | `[window]` |
| Product support lead | `[name / backup]` | `[monitored contact]` | `[window]` |
| Identity/MDM administrator | `[name / backup]` | `[channel]` | `[window]` |
| Cloud/database operator | `[name / backup]` | `[channel]` | `[window]` |
| Privacy/security contact | `[name / backup]` | `[channel]` | `[window]` |

Confirm that every listed channel is monitored during the stated window. Venue Wrangler is not the venue's emergency-response system; list the venue's existing operational fallback: `[procedure/contact]`.

## Severity and service targets

Agree targets only after confirming staffing and escalation coverage. Response means a human acknowledges and begins triage; it does not mean resolution.

| Severity | Pilot impact definition | Coverage window | Acknowledgement target | Update cadence | Escalation owner |
| --- | --- | --- | --- | --- | --- |
| Critical | `[e.g. suspected tenant data exposure or broad event-time outage]` | `[window]` | `[agreed target]` | `[agreed target]` | `[name]` |
| High | `[core sign-in/workflow unavailable for the pilot]` | `[window]` | `[agreed target]` | `[agreed target]` | `[name]` |
| Normal | `[isolated device, training, or non-blocking issue]` | `[window]` | `[agreed target]` | `[agreed target]` | `[name]` |

- Planned maintenance notice and approval: `[process / lead time]`
- Service availability target, if any: `[value / measurement / exclusions]`
- Support outside the event window: `[included / excluded / separately staffed]`
- Security incident customer-notification terms: `[refer to counsel-approved DPA/contract]`

## Recovery and customer responsibilities

- Agreed recovery time objective (RTO): `[value and scope]`
- Agreed recovery point objective (RPO): `[value and scope]`
- Backup cadence, retention, and restore owner: `[approved values]`
- Last restore exercise and evidence location: `[date / record]`
- Customer responsibilities for IdP, claims, MDM, roster, and device access: `[list]`
- Product responsibilities for API, database, push, evidence storage, and release: `[list]`
- Offline report and note reconciliation owner after an outage: `[name / process]`
- Data retention and deletion at pilot end: `[approved schedule / owner]`
- Escalation if either primary contact is unavailable: `[backup path]`

## Review and approval

| Party | Name and title | Approval method | Date |
| --- | --- | --- | --- |
| Product owner | `[name / title]` | `[recorded acceptance]` | `[date]` |
| Venue owner | `[name / title]` | `[recorded acceptance]` | `[date]` |
| Security/privacy reviewer | `[name / title]` | `[review record]` | `[date]` |

Store the completed agreement with the approved customer contract. This repository template is not a substitute for legal review or a signed SLA.
