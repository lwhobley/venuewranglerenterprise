# Local test organization

The development database seed creates **Venue Test Lab**, organization code `venue-test-lab`, with one active venue, one event, one location, and an active test operator. The local login checks all of those records before returning `verificationStatus: verified-test-fixture`. This status verifies only that the local synthetic fixture is ready; it is not a customer identity, domain, or security certification.

The login endpoint exists only when `NODE_ENV=development` and `ENABLE_DEV_TEST_LOGIN=true`. Production rejects it, and production API tokens must still come from configured Okta or Microsoft Entra ID. Docker Compose binds the API to `127.0.0.1:3000` and uses the following disposable local credentials:

- Email: `tester@venuewrangler.invalid`
- Password: `local-test-password-change-me`

Change the password in `services/api/docker-compose.yml` if this development API will be shared. Never use these credentials with a customer environment.

From `services/api`, start Docker Desktop and run `docker compose up --build -d`. The `migrate` service applies migrations and `prisma/seed-development.sql` before the API starts. In a local Flutter debug build pointed at `http://localhost:3000`, enter `venue-test-lab` as the organization access code and tap Continue. The app then shows the local test email and password fields. On a USB-connected Android device, run `adb reverse tcp:3000 tcp:3000` before launching Flutter with `--dart-define=VENUE_API_BASE_URL=http://localhost:3000`. The ordinary SSO provider lookup does not serve this test organization.

The test account receives a one-hour, local-only API token with admin access to the synthetic organization. Its signed test-fixture claim displays a green test banner in the app. It cannot access another tenant or use the production OIDC path. Restarting Docker does not remove the test database volume; the seed is safe to rerun after migrations.
