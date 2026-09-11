# Production operations

## Health and monitoring

- API: `https://venue-wrangler-api-922889404273.us-east1.run.app/api/health`
- Cloud Run service: `venue-wrangler-api` in `us-east1`
- The `venue_wrangler_5xx` log-based metric counts HTTP 5xx responses.
- Alert policy: `Venue Wrangler API 5xx errors` (`projects/venuewrangler/alertPolicies/7994759751285739344`).
- The policy is enabled and sends email notifications through the production alerts notification channel.

Keep a second notification destination (for example, an on-call webhook) for a staffed production launch.

## Rollback

Cloud Run keeps immutable revisions. To roll back, list revisions and route traffic to the last known-good one:

```bash
gcloud run revisions list --service=venue-wrangler-api --region=us-east1 --project=venuewrangler
gcloud run services update-traffic venue-wrangler-api \
  --to-revisions=venue-wrangler-api-REVISION=100 \
  --region=us-east1 --project=venuewrangler
```

After rollback, verify `/api/health`, `/api/v1/documents` (expect `401` without a session), and the mobile client login flow.

## Database backups and restore

The production database is Supabase project `dhgyezfkgbzzsuyrdpek`. It is currently on Supabase's **Free plan**, which does **not** include scheduled backups. Point-in-time recovery (PITR) is also unavailable until the project is upgraded to Pro and the PITR add-on is enabled. Upgrade before launch, then verify **Database → Backups** and perform a restore drill against a separate project before the first customer migration.

Until an upgrade is possible, `.github/workflows/database-backup.yml` provides a nightly logical backup to S3 with SSE-S3 encryption. Configure these repository secrets before relying on it: `PRODUCTION_POOLER_DATABASE_URL` (Supavisor session-mode URL), `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_REGION`, and `BACKUP_S3_BUCKET`. The backup IAM identity must allow `s3:GetLifecycleConfiguration` on that bucket in addition to object upload/read verification; the workflow fails if its enabled `database-backups/` lifecycle rule is not exactly 30 days. Perform a restore drill before launch.

Never store a database password in this repository. For a restore, pause Cloud Run traffic, restore or clone the Supabase project, update `DATABASE_URL` as a new Cloud Run revision, run Prisma migrations, smoke-test, and then shift traffic back.

### Connection budget

Set `DATABASE_POOL_SIZE=5` for each Cloud Run revision unless the Supabase connection budget and Cloud Run maximum instance count have been reviewed together. The current database permits 60 backend connections. Cloud Run service-level autoscaling is capped at 8 instances (40 pooled connections), leaving 20 connections for Supabase administration, migrations, and incident response. Recheck this budget before changing either limit.

## POS webhook secret rotation

Managers can rotate a compromised or stale POS secret with `POST /api/v1/pos/connections/:id/rotate-secret`. The connection lookup is venue-scoped. The response displays the new plaintext secret once; only its SHA-256 digest is stored. Update the POS integration immediately because the old secret stops authenticating as soon as rotation completes. Never paste the plaintext secret into source control, tickets, or logs.

## Release checklist

1. Confirm GitHub Mobile CI and API CI are green.
2. Confirm the Cloud Run revision has the production secret set and 100% traffic.
3. Confirm the alert notification channel is verified.
4. Record the current revision ID before every deploy for rollback.
