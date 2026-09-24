# Venue Wrangler Enterprise

Flutter event operations client backed by the Venue Wrangler API. The signed-in app loads the caller's tenant, venues, events, locations, issues, and operational tasks from the API; operational access is driven by verified identity-provider capabilities and scopes. The offline issue outbox encrypts pending reports in platform secure storage and retries them when connectivity returns.

## Run locally

Install Flutter and the API dependencies, then configure a development API origin:

```powershell
flutter pub get
flutter run -d chrome --dart-define=VENUE_API_BASE_URL=http://localhost:3000
```

For a physical phone, use the development machine's reachable HTTPS/LAN API address instead of `localhost`. Release builds require an HTTPS API origin. GitHub Actions requires the repository variable `VENUE_API_BASE_URL` and passes it into the TestFlight IPA.

## API-backed pilot workflows

- Event selection and the Today view show tenant-scoped API data.
- Issue reports are queued offline and posted to the issue API when connected. The Issues page loads server records and exposes authorized triage, assignment, escalation, resolve, verify, and close actions.
- Plan, Staffing, Service, and Stock are operational task types with tenant/event/location constraints and append-only audit records.
- `tenant:admin` users can create venues, locations, events, and people through the Setup page. The API derives the tenant from the verified issuer mapping and enforces the capability on every write.

Push delivery, SCIM provisioning, external system connectors, device management, and formal security/compliance attestations still require separate product and customer infrastructure work. Photo evidence and a short-lived encrypted offline read cache are implemented in the app, but the API's private Cloud Storage bucket and service identity must be configured before photo uploads work in a deployed environment. See `docs/product/pilot-readiness.md` and `docs/security/enterprise-sso-setup.md`.
