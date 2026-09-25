# Cloud Run API deployment

`.github/workflows/deploy-api.yml` is a manual production deployment. It builds the API image, deploys a tagged Cloud Run candidate with no customer traffic, requires `/api/health` to report an active database connection and all 43 RLS-protected tables enforced, then promotes the candidate. It never applies database migrations; run the approved migrator process first.

## GitHub configuration

Create the `production` GitHub Actions environment and configure these repository variables:

| Variable | Meaning |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project that owns Artifact Registry, Secret Manager, Cloud Run, and the runtime service account |
| `GCP_REGION` | Cloud Run and Artifact Registry region |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity Federation provider resource name |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | Service account the GitHub workflow may impersonate |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Dedicated least-privilege identity assigned to the Cloud Run service |
| `ARTIFACT_REGISTRY_REPOSITORY` | Artifact Registry Docker repository ID in `GCP_REGION` |
| `CLOUD_RUN_SERVICE` | Cloud Run service name |
| `DATABASE_URL_SECRET` / `DATABASE_URL_SECRET_VERSION` | Secret Manager secret ID and pinned version for the `venue_app` runtime connection string |
| `SSO_PROVIDERS_JSON_SECRET` / `SSO_PROVIDERS_JSON_SECRET_VERSION` | Secret Manager secret ID and pinned version for the issuer-to-tenant/provider configuration |
| `SCIM_PROVIDERS_JSON_SECRET` / `SCIM_PROVIDERS_JSON_SECRET_VERSION` | Secret Manager secret ID and pinned version for tenant-specific SCIM bearer tokens; use `[]` to disable provisioning |
| `INTEGRATION_PROVIDERS_JSON_SECRET` / `INTEGRATION_PROVIDERS_JSON_SECRET_VERSION` | Secret Manager secret ID and pinned version for inbound integration HMAC secrets; use `[]` until a source is configured |
| `EVIDENCE_BUCKET` | Private Cloud Storage bucket name for issue evidence |
| `FCM_PROJECT_ID` | Optional Firebase project ID used for mobile push notifications; device registration returns unavailable until configured |
| `CORS_ORIGINS` | Comma-separated allowlist of approved browser origins; set only origins actually used by approved clients |

The workflow uses GitHub OIDC through Workload Identity Federation; it does not need a service-account JSON key or secret values in GitHub. Restrict the identity provider condition to repository `lwhobley/venuewranglerenterprise`, branch `main`, and this deployment workflow. Grant the deployer only Artifact Registry write, Cloud Run deployment, and service-account act-as permissions. Give the Cloud Run runtime identity access to the named secret versions, only the necessary Cloud Storage object operations and IAM signing permission, and `cloudmessaging.messages.create` on the FCM project. Do not grant project-wide Editor or use a long-lived JSON key.

The Cloud Run service must allow unauthenticated network invocation so the native mobile client can reach it; API routes remain protected by verified OIDC bearer tokens and server-side capability/scope checks. Do not expose database credentials through GitHub variables, build arguments, image layers, or workflow output.

## Database and first deployment order

1. Create the private bucket with uniform bucket-level access and public access prevention. Configure a dedicated runtime service identity and verify it can sign constrained upload policies and read/write only within the evidence bucket.
2. Provision PostgreSQL `venue_app` and `venue_migrator` as separate non-superuser, `NOBYPASSRLS` roles. Use TLS and keep the application `DATABASE_URL` on `venue_app`.
3. Apply the complete ordered migration chain through the authorized migration process: `20260923000000_issue_vertical_slice`, `20260924000000_issue_locations`, `20260925000000_durable_issue_events`, `20260926000000_operations_admin`, `20260927000000_notifications`, `20260928000000_issue_evidence`, `20260929000000_scim_user_lifecycle`, `20260930000000_signed_integration_events`, `20261001000000_push_devices`, `20261002000000_external_task_mappings`, `20261003000000_tenant_setup_audit`, `20261004000000_staff_shift_workflow`, `20261005000000_staff_availability`, `20261006000000_person_qualifications`, `20261007000000_staff_rest_policy`, `20261008000000_staff_breaks`, `20261009000000_offline_attendance_claims`, `20261010000000_staffing_coverage`, `20261011000000_qualification_evidence_review`, `20261012000000_issue_location_evidence`, `20261013000000_inventory_count_workflow`, `20261014000000_hospitality_order_fulfillment`, `20261015000000_stock_transfers`, `20261016000000_event_closeout`, `20261017000000_vendor_staffing_requests`, and `20261018000000_post_close_corrections`. Verify the database migration history before deploying the API revision.
4. Store `DATABASE_URL`, `SSO_PROVIDERS_JSON`, `SCIM_PROVIDERS_JSON`, and `INTEGRATION_PROVIDERS_JSON` in Secret Manager, then record exact enabled version numbers in the GitHub variables above. Use `[]` for SCIM and integrations until configured. Never use a moving `latest` selector for production deployment.
5. Run **Actions → Deploy API to Cloud Run** from `main`. The workflow shifts traffic only if the tagged revision passes the RLS health gate. Record the promoted revision and service URL.
6. Set `VENUE_API_BASE_URL` in GitHub Actions variables to the verified HTTPS service origin. Run the iOS TestFlight workflow only after customer SSO and issue/evidence acceptance checks pass.

## Recovery

The workflow deploys by commit SHA and retains prior Cloud Run revisions. If candidate health fails, no customer traffic is promoted. If the promoted revision causes an incident, the named Cloud Run operator routes traffic to the last known healthy revision and verifies `/api/health` before restoring the event workflow. Database migration rollback is a separate operation and must follow the approved backup/restore plan; do not assume an application rollback reverses a schema migration.

## External setup still required

This repository does not create the Google project, Workload Identity Federation pool/provider, IAM bindings, database roles, Secret Manager versions, bucket, backups, monitoring, or Cloud Run service. These must be created and verified by the customer/product cloud administrator before the workflow can deploy.
