# Mobile push notification setup

The app uses Firebase Cloud Messaging (FCM) for opt-in iOS and Android alerts. The in-app notification inbox remains the durable record. Push sends happen after the operational transaction commits; transient FCM failure does not roll back the workflow or lose the inbox item. The FCM text is generic and carries only a notification ID and type, not the issue title, staff name, or venue details. When a push is opened, the app fetches the recipient-scoped inbox row, checks current event assignment and workflow capability, and routes to the permitted destination. Issue notifications select the referenced issue. The same route works for read inbox items.

## Firebase and Apple setup

1. Create a Firebase project and register the iOS app as `com.venuewrangler.enterprise` and Android app as `com.example.venue_wrangler_prototype`.
2. In Apple Developer, enable the **Push Notifications** capability for App ID `com.venuewrangler.enterprise`. Create or refresh the App Store provisioning profile afterward so it contains the `aps-environment` entitlement.
3. Create an Apple APNs authentication key with Apple Push Notifications service enabled. Upload its `.p8` file, Key ID, and Apple Team ID to Firebase Project Settings → Cloud Messaging → iOS app configuration. The App Store Connect API `.p8` used by the TestFlight upload workflow is a different key and cannot be used as the APNs key.
4. To enable client-side push in TestFlight builds, set these GitHub Actions repository variables: `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, and `FIREBASE_PROJECT_ID`. They are optional until Firebase is configured; without them the app still builds and push remains unavailable. These values are Firebase client-app identifiers, not service-account credentials. The workflow passes them as Dart defines; no Firebase service-account JSON file is bundled.
5. Set the Cloud Run deployment variable `FCM_PROJECT_ID` to the same Firebase project ID to enable server-side delivery. Enable the Firebase Cloud Messaging API and grant the Cloud Run runtime service identity `cloudmessaging.messages.create` on that project. The API obtains OAuth credentials from its runtime identity; do not create or upload a service-account key. Without this setting, the API continues to deploy, but push-device registration returns unavailable.

## Permission and acceptance checks

- A user with `notification:read` enables device alerts from the in-app Notifications inbox. Android/iOS permission is requested in response to that action.
- Device tokens are stored under tenant and user RLS, replaced when they rotate, deleted when the user opts out, and revoked on sign-out when the device can reach the API. Sign-out disables local push immediately and rotates the installation ID even when offline, so a later user on the device is not stuck behind the previous account's registration.
- Install the signed TestFlight build on a physical iPhone, accept notifications, and verify alerts with the app backgrounded and terminated. Also test Android 13+ permission behavior on a Play Services device.
- Test an iOS foreground alert and the in-app refresh behavior. A denied OS permission leaves the durable in-app inbox available.
- Tap push alerts for issues, shifts, hospitality orders, closeout follow-ups, and vendor staffing requests; confirm each opens the correct assigned event and permitted workflow. Verify an issue alert selects the matching issue. Confirm a revoked event assignment or capability does not open that workflow.
- Confirm Firebase reports successful message delivery and that the active App Store profile includes `aps-environment=production` before a venue event.

Firebase must be configured for this feature to operate. The local app intentionally leaves push disabled when the Firebase Dart defines are absent.
