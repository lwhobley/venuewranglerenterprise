# MDM and Microsoft Intune distribution

This guide specifies the mobile device management (MDM) distribution configuration and operator workflows for Venue Wrangler Enterprise across Apple iOS (via Apple Business Manager and Microsoft Intune) and Android Enterprise.

## Honest boundary and non-claims

This repository provides:
- The Flutter client build configuration and environment parameterization.
- The standard AppConfig managed configuration dictionary schema.
- The administrative deployment procedures and configuration profile specifications.

This repository does **not** provide, and no repository change can claim:
- Enrolled physical handheld devices, tablet kiosks, or staging hardware.
- Apple Developer Enterprise Program certificates, In-House Provisioning Profiles, or Apple Business Manager organization linkage.
- Active Microsoft Intune tenant tenant-wide app assignments, conditional access policies, or enrolled device licenses.
- Automated validation of MDM enrollment or over-the-air binary distribution.

Physical device enrollment, device wiping/supervision, MDM license assignment, and customer Intune/Entra tenant administration must be completed by the customer's enterprise IT operations team.

---

## Managed App Configuration (AppConfig) schema

When Venue Wrangler Enterprise is distributed to supervised corporate-owned devices (or MAM-managed devices) via Microsoft Intune, Jamf Pro, Workspace ONE, or Google Workspace, administrators can pre-provision connection parameters using the industry-standard AppConfig dictionary.

### Supported configuration keys

| Key | Type | Requirement | Description | Example |
| --- | --- | --- | --- | --- |
| `server_url` | String | **Required** | The verified HTTPS API origin for the Cloud Run deployment. Must begin with `https://`. Do not use wildcard or unverified staging origins. | `https://api.venue.example.com` |
| `organization_hint` | String | Optional | The tenant slug or UUID hint used to pre-populate the enterprise SSO sign-in domain. | `us-east-arena-01` |
| `allow_camera_evidence` | Boolean | Optional (Default: `true`) | Enables or disables on-device camera access for issue photo attachments. | `true` |
| `allow_location_evidence` | Boolean | Optional (Default: `true`) | Enables or disables foreground GPS coordinate attachment for issue locations. | `true` |
| `offline_cache_max_hours` | Integer | Optional (Default: `12`) | Maximum hours encrypted offline drafts and roster caches remain valid without re-authentication. | `12` |

### Intune App Configuration XML representation (iOS)

```xml
<dict>
    <key>server_url</key>
    <string>https://api.venue.example.com</string>
    <key>organization_hint</key>
    <string>us-east-arena-01</string>
    <key>allow_camera_evidence</key>
    <true/>
    <key>allow_location_evidence</key>
    <true/>
    <key>offline_cache_max_hours</key>
    <integer>12</integer>
</dict>
```

---

## Apple iOS distribution workflow (Microsoft Intune + ABM)

For iOS venue devices (iPhones for mobile supervisors, iPads for host stands and kitchen queues), deployment uses **Apple Business Manager (ABM)** Custom Apps or Volume Purchase Program (VPP) integrated with Microsoft Intune.

### Operator deployment steps

1. **Build and package the signed IPA candidate:**
   - Compile the Flutter application with release signing assets (`--release --export-options-plist=...`).
   - Embed the organization's verified distribution profile and Entitlements (`keychain-access-groups`, `aps-environment`).
2. **Publish Custom App to Apple Business Manager:**
   - Upload the binary candidate to App Store Connect configured as a **Custom App** restricted to the customer organization's ABM Organization ID and Organization Name.
   - Alternatively, for closed enterprise internal testing, use TestFlight external groups before general custom app availability. TestFlight alone is not MDM distribution.
3. **Link Apple VPP token in Microsoft Intune:**
   - In the Microsoft Intune admin center (`endpoint.microsoft.com`), navigate to **Tenant administration → Connectors and tokens → Apple VPP Tokens**.
   - Verify the token status is `Active` and sync purchases.
4. **Create Managed App Configuration Policy in Intune:**
   - Navigate to **Apps → App configuration policies → Add → Managed devices**.
   - Platform: **iOS/iPadOS**.
   - Targeted app: **Venue Wrangler Enterprise**.
   - Configuration settings format: **Use configuration designer** or **Enter XML data** using the AppConfig schema above.
   - Set `server_url` to the customer's production Cloud Run HTTPS URL.
5. **Assign the Application to Targeted Entra Groups:**
   - Navigate to **Apps → iOS/iPadOS → Venue Wrangler Enterprise → Properties → Assignments**.
   - Assign as **Required** for designated device groups:
     - `SG-Venue-Ops-Handhelds` (Supervised iPhones)
     - `SG-Venue-Kitchen-iPads` (Kiosk/Shared iPads)
   - Enable **License type: Device licensing** for shared/kiosk hardware so individual Apple IDs are not required on floor devices.
6. **Configure Shared iPad or Single App Mode (Optional):**
   - For dedicated kitchen prep stations or host stand terminals, create an Intune **Device configuration profile → Kiosk (Single App Mode)** locking the device to Venue Wrangler Enterprise.

---

## Android Enterprise distribution workflow (Microsoft Intune + Managed Google Play)

For dedicated Android barcode scanners (e.g., Zebra, Honeywell) and operations tablets:

### Operator deployment steps

1. **Build the release Android App Bundle (AAB) or APK:**
   - Build using `./gradlew bundleRelease` with the organization's release keystore.
2. **Publish Private App in Managed Google Play:**
   - In Intune admin center, navigate to **Apps → Android → Add → Managed Google Play app**.
   - Select **Private apps** (lock icon), upload the release bundle, specify Package Name `com.venuewrangler.enterprise`, and publish to the customer's enterprise organization.
3. **Create Managed Configuration Profile:**
   - Under **Apps → App configuration policies → Add → Managed devices**, select **Android Enterprise**.
   - Configure managed configuration properties matching the AppConfig schema (`server_url`, `organization_hint`).
4. **Assign to Dedicated Device Groups:**
   - Assign as **Required** to the Entra ID group for corporate-owned dedicated devices (COSU).
   - If using shared scanners, configure Intune shared device mode or Zebra StageNow enrollment profiles.

---

## Operator pre-event verification checklist

Before distributing devices to event staff, operators must complete this verification on at least one sample device per device profile:

- [ ] **MDM enrollment:** Device reports compliant in Microsoft Intune and displays enrolled management profile.
- [ ] **App installation:** Venue Wrangler Enterprise installs automatically without requesting an Apple ID or Google account on the device.
- [ ] **Managed configuration injection:** On launch, the app connects to the configured `server_url` without prompting the user to type a server address.
- [ ] **Network connectivity:** Handheld device resolves the Cloud Run API hostname over venue operational Wi-Fi (WPA3-Enterprise / 802.1X SSID) and cellular fallback.
- [ ] **Authentication:** Scoped operator signs in via customer Entra ID / Okta; IdP token issues expected `operations:read`, `operations:write`, or `hospitality:*` capabilities.
- [ ] **Camera / Scanner test:** If issue reporting or asset scanning is enabled, verify camera permission is granted by MDM policy without interactive prompt block.
- [ ] **Push device registration:** If notifications are enabled, verify device registers its token with `/api/v1/devices/push` under the user's tenant session.
- [ ] **Handoff lock:** Verify kiosk or supervisor devices lock with enterprise passcode after inactivity timeout.
