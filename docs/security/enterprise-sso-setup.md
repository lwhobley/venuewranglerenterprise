# Enterprise SSO setup

Venue Wrangler mobile sign-in uses OpenID Connect Authorization Code with PKCE in the system browser. An organization may enable Okta, Microsoft Entra ID, or both. The app first asks for the organization's access code and then lists only that organization's enabled providers.

## API configuration

Configure `SSO_PROVIDERS_JSON` on the API with one entry per organization/provider pair. The example in `services/api/.env.example` is a template; replace every placeholder with values approved by that organization's identity team. The `tenantId` must be the existing `organizations.id` value. Provider entries contain public issuer, native client ID, API audience, and requested scopes; do not put client secrets in the app or this configuration.

The issuer must be the exact HTTPS issuer configured for the provider's authorization server. Use a tenant-specific Microsoft Entra v2 issuer and an Okta custom authorization-server issuer. The API discovers the issuer's OIDC metadata, requires the advertised JWKS URI to share the issuer's HTTPS origin, and verifies RS256 signature, exact issuer, audience, authorized client, issue time, and a maximum one-hour token age. Production startup fails if no provider is configured. HS256 local development tokens remain restricted to non-production.

The API access token must include these claims, issued only by the configured IdP for its protected API audience:

- `cid` (Okta) or `azp` (Entra): must equal the configured native client ID.
- `capabilities`: allowed Venue Wrangler capability strings, such as `issue:report` and `issue:read`.
- `venue_ids`, `event_ids`, `location_ids`: the user's current UUID scopes.
- `assignable_user_ids`: user identifiers the actor may assign work to.
- Standard `sub`, `iss`, `aud`, `iat`, and `exp` claims.

The API derives the Venue Wrangler organization UUID from the configured issuer-to-organization mapping; it does not trust a tenant selector in the access token or app request body. Map IdP groups/app roles to these server-enforced capabilities and current operational scopes. Each change to membership, group mapping, or venue/event assignment must take effect in newly issued API access tokens; keep token lifetimes short enough for the customer's revocation policy.

## Identity-provider app registration

Register a **public native/mobile application** separately in Okta and/or Entra for each configured authorization server. Use the redirect URI:

`com.venuewrangler.enterprise:/oauth2redirect`

Register the API as a protected resource and configure the corresponding audience and delegated API scope. Do not create a client secret for the native app. Require the organization's MFA and conditional-access policy at its IdP, with phishing-resistant MFA for privileged roles where required.

## Mobile build configuration

The Android AppAuth redirect scheme is configured in `android/app/build.gradle.kts`; iOS uses the same callback scheme in `ios/Runner/Info.plist`. Android/iOS are the currently wired native clients. iOS project files were generated, but an iOS build and device callback still require macOS/Xcode and the customer's registered callback URI.

Pass the deployed API origin at build time, for example:

```powershell
flutter build apk --dart-define=VENUE_API_BASE_URL=https://<api-host>
```

The provider chooser is not sufficient to enable sign-in by itself. The organization must configure both its provider app registration and API token claims/audience before a successful login can be completed.
