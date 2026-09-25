# Pilot security evidence register

Use this register with the customer security review. Repository code and CI results are evidence of implementation and repeatable checks; they are not proof of a production deployment, SOC 2 attestation, or a completed independent assessment. A pilot is not security-approved until every applicable customer-owned and independent-review item below has an evidence link and named approver.

## Evidence status

- **Repository evidence:** a source-controlled implementation, test, or policy exists.
- **CI verified:** the current CI run exercised the stated automated check.
- **Environment evidence required:** the check must be repeated against the approved staging or production environment.
- **External evidence required:** a customer, independent assessor, insurer, or legal reviewer must supply or approve it.

Do not change a status without recording the evidence location, verification date, commit or environment, and reviewer. Never attach credentials, production data, or unredacted incident content to this register.

## Technical controls

| Control area | Current repository evidence | Status | Pilot evidence to attach | Owner / approver |
| --- | --- | --- | --- | --- |
| Tenant isolation and runtime database role | PostgreSQL RLS and FORCE RLS; the worktree health gate expects 46 protected tables, including hospitality handoff receipts and menu items; CI provisions separate `venue_migrator` and `venue_app` roles and runs tenant-isolation probes. | CI verified on [run 36147918396](https://github.com/lwhobley/venuewranglerenterprise/actions/runs/36147918396) for commit `b19f18a` with all 46 protected tables on 2026-09-25. Staging evidence is still required. | Approved staging health response, runtime role attributes, full tenant-isolation run, deployed commit SHA. | Cloud operator / security reviewer |
| API authorization | Signed identity claims carry capability and venue/event/location scope; API guards and service checks enforce writes. | Repository evidence; CI unit-tested | Customer IdP token claim mapping, negative tests for cross-scope reads/writes, revocation check. | Identity administrator / security reviewer |
| Audit history | Tenant-scoped append-only audit paths cover issue, staffing, setup, inventory, hospitality, closeout, and correction workflows. | CI verified for selected database paths | Staging audit samples using synthetic records; retention and access review. | Product owner / customer administrator |
| Secrets and deployment identity | Deployment workflow uses GitHub OIDC/Workload Identity Federation and pinned Secret Manager versions; deploy workflow does not run migrations. | Repository evidence; CI workflow validated | Cloud IAM policy export, secret version inventory, deployment log, candidate health result, migration approval record. | Cloud operator |
| Issue evidence storage | Private signed upload/download flow validates content type, byte count, and SHA-256. | API tests; environment evidence required | Bucket public-access prevention and uniform-access settings, service-account permissions, upload/read test, retention setting. | Cloud operator / privacy owner |
| Offline data handling | Identity-and-capability-scoped encrypted storage covers issue reports/evidence, attendance claims, hospitality drafts, and closeout summary notes. | Flutter analysis/tests; CI verified | Managed-device storage validation, lock/logout behavior, lost-device controls, approved offline retention period. | Mobile owner / MDM administrator |
| Notifications | Durable tenant-scoped inbox; optional generic FCM/APNs alerts avoid sensitive content. | API tests; environment evidence required | Firebase/APNs configuration evidence, device registration/revocation test, sample redacted payload, delivery-failure behavior. | Mobile owner / cloud operator |
| Software supply chain | CI runs API vulnerability audit; Dependabot checks npm, Flutter packages, and Actions. | CI verified | Exact commit's CI run, advisory disposition, approved exception and expiry if any. | Engineering owner |
| Backups and recovery | Runbook defines isolated restore and validation steps. | Repository procedure only | Backup configuration, last successful restore evidence, agreed RPO/RTO, customer-approved recovery test. | Database operator / customer owner |

## Customer, independent, and contractual evidence

| Required item | Status | Evidence / decision needed | Owner / approver |
| --- | --- | --- | --- |
| Customer Okta or Entra SSO acceptance | Environment evidence required | Issuer, audience, client, claims, capability/scope mapping, login and revocation results from the customer's tenant. | Customer identity administrator |
| SCIM and inbound integration credentials | Environment evidence required | Per-tenant secrets stored in Secret Manager, lifecycle/replay results, rotation owner and schedule. | Customer identity / integration owner |
| MDM/Intune distribution | External and environment evidence required | Signed build, Apple Business Manager or selected MDM assignment, managed-device install/update and removal result. | Customer MDM administrator |
| Independent penetration test | External evidence required | Approved scope, assessor, dates, final report in restricted storage, finding owners, remediation and retest evidence. | Product owner / independent assessor |
| SOC 2 or customer control questionnaire | External evidence required | State the actual assurance status; attach only reports or policies that have been approved for customer sharing. Do not imply certification from CI results. | Product owner / security reviewer |
| DPA, subprocessors, and data retention | External/legal review required | Counsel-approved DPA, current subprocessor list, data categories, retention/deletion schedule, breach notice terms. | Legal/privacy owner |
| Insurance | External evidence required | Current policy and customer-required limits confirmed by broker/customer. | Product owner |
| Support coverage and SLA | External/customer agreement required | Completed [pilot support agreement template](../operations/pilot-support-agreement-template.md), named monitored contacts, staffed event window, response and recovery objectives. | Product owner / customer owner |

## Release decision

- Pilot venue and event: `[customer-approved scope]`
- API environment and deployed commit: `[verified URL and SHA]`
- Migration level and operator: `[verified migration and identity]`
- Security approver and date: `[name / date]`
- Customer operational approver and date: `[name / date]`
- Open exceptions, owner, expiry, and approval: `[none or recorded exception]`
- Decision: `[NOT READY / APPROVED FOR LIMITED PILOT / STOP]`

Keep this record in the customer-approved restricted system. It contains pointers and decisions, not secrets or customer operational data.
