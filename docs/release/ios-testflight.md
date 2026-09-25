# iOS TestFlight release

The iOS app bundle identifier is `com.venuewrangler.enterprise`. It is also the native OAuth callback URL scheme, so keep the app registration and Xcode bundle identifier aligned.

## Apple setup

1. Enroll in the Apple Developer Program and create an App Store Connect app using bundle ID `com.venuewrangler.enterprise`.
2. Create an App Store Connect API key with access to the app and note its Key ID and Issuer ID. Keep the `.p8` private key secure.
3. Create an Apple Distribution certificate and export it with its private key as a password-protected `.p12` file.
4. Create an App Store provisioning profile for `com.venuewrangler.enterprise` named exactly `AppStore com.venuewrangler.enterprise`, using that distribution certificate.

## GitHub Actions configuration

In the repository's **Settings → Secrets and variables → Actions**, add these variables:

| Variable | Value |
| --- | --- |
| `APPSTORE_ISSUER_ID` | App Store Connect Issuer ID |
| `APPSTORE_API_KEY_ID` | App Store Connect API Key ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `VENUE_API_BASE_URL` | Verified HTTPS origin of the deployed Venue Wrangler API; required by the workflow |
| `FIREBASE_API_KEY` | Firebase iOS app API key; optional until Firebase push is configured |
| `FIREBASE_APP_ID` | Firebase iOS app ID; optional until Firebase push is configured |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging sender ID; optional until Firebase push is configured |
| `FIREBASE_PROJECT_ID` | Firebase project ID; optional until Firebase push is configured |

Add these secrets:

| Secret | Value |
| --- | --- |
| `APPSTORE_API_PRIVATE_KEY` | Entire contents of the App Store Connect `.p8` key |
| `APPSTORE_CERTIFICATES_FILE_BASE64` | Base64-encoded `.p12` distribution certificate |
| `APPSTORE_CERTIFICATES_PASSWORD` | Password used when exporting the `.p12` |

`VENUE_API_BASE_URL` must be the actual deployed API origin, without a guessed Cloud Run hostname. The workflow fails before signing if the value is missing or does not begin with `https://`. Without the optional Firebase variables and APNs key configuration, the app builds but device push alerts remain unavailable; durable in-app notifications still work.

On macOS, encode the certificate with `base64 -i distribution.p12 | pbcopy`. Do not commit certificates, API keys, or provisioning profiles to the repository.

## Run a release

Use **Actions → iOS TestFlight → Run workflow** to upload the current `main` revision, or push a tag matching `ios-v*` (for example `ios-v0.1.0`). The workflow builds on a macOS runner, increments the App Store build number from the GitHub Actions run number, signs and exports an IPA, uploads it to App Store Connect, and retains the IPA as a workflow artifact. Apple processes the upload before it appears in TestFlight.

The first upload may require completing the app's metadata, privacy details, export compliance, and TestFlight tester setup in App Store Connect. Uploading the binary does not automatically distribute it to testers.
