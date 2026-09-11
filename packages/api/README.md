# Venue Wrangler NestJS API

This package is the production backend for Venue Wrangler.

## Local Setup

```bash
npm install
npm run api:prisma:generate
npm run api:migrate:dev
npm run api:dev
```

## Production migrations

Run `npx prisma migrate deploy` (or the project equivalent) against the production database as part of every release that includes a new migration under `packages/api/prisma/migrations/`.

Do **not** rely on `prisma db push` in production; it does not record migration history.

The app also has a separate `supabase/migrations` history and is not the deployment path here.

## Notable constraints & indexes (enforced in CI)

- `TimeEntry_open_state_check` — open entries must have `clockOutAt` null and vice versa.
- Partial unique index `TimeEntry_profileId_open_key` (one open entry per profile).
- Partial unique index `Profile_unclaimed_venue_email_key` (one unclaimed roster row per venue + email) from migration `20260810153000_profile_accrual_defaults_and_unclaimed_unique`.
- New profiles default `sickHoursAccrued` / `ptoHoursAccrued` to `0` (same migration).
- Auth is administrator PIN sign-in (invite-provisioned). There is no public register or in-app checkout.
- Optional `MEDIA_TOKEN_SECRET` signs media access tokens; falls back to `JWT_SECRET`. Prefer setting it in production.
- `CORS_ORIGINS` adds extra exact browser origins on top of the hardcoded product allowlist.
- See `.env.example` for JWT, SSO, Redis, RabbitMQ, S3, Gemini, Resend, and worker-credential variables.
