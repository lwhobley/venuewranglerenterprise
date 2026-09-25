import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'managed_app_configuration.dart';

class ApiConfiguration {
  static const _configuredBaseUrl =
      String.fromEnvironment('VENUE_API_BASE_URL');
  static ManagedAppConfiguration _managed = const ManagedAppConfiguration();
  static String? _managedConfigurationError;

  static Future<void> initialize() async {
    try {
      _managed = await ManagedAppConfiguration.load();
    } on MissingPluginException {
      _managed = const ManagedAppConfiguration();
    } catch (_) {
      _managedConfigurationError =
          'Could not read this device’s managed app settings. Relaunch the app or contact your administrator.';
    }
  }

  static String get _baseUrl =>
      (_managed.serverUrl ?? _configuredBaseUrl)
          .replaceFirst(RegExp(r'/+$'), '');

  static String? get organizationHint => _managed.organizationHint;
  static bool get allowCameraEvidence => _managed.allowCameraEvidence;
  static bool get allowLocationEvidence => _managed.allowLocationEvidence;
  static Duration get offlineCacheMaxAge =>
      Duration(hours: _managed.offlineCacheMaxHours);

  static String? get error {
    if (_managedConfigurationError != null) return _managedConfigurationError;
    if (_baseUrl.isEmpty) {
      return kReleaseMode
          ? 'This build is missing the Venue Wrangler API address. Contact your administrator.'
          : null;
    }
    final uri = Uri.tryParse(_baseUrl);
    if (uri == null || !uri.hasAuthority || uri.host.isEmpty) {
      return 'The Venue Wrangler API address in this build is invalid.';
    }
    final isLocalDevelopment =
        kDebugMode && (uri.host == 'localhost' || uri.host == '10.0.2.2');
    if (uri.scheme != 'https' && !isLocalDevelopment) {
      return 'The Venue Wrangler API must use HTTPS.';
    }
    if (uri.userInfo.isNotEmpty ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        uri.query.isNotEmpty ||
        uri.fragment.isNotEmpty) {
      return 'The Venue Wrangler API address must be an origin, without credentials, path, query, or fragment.';
    }
    return null;
  }

  static String get baseUrl => _baseUrl.isEmpty
      ? 'http://localhost:3000'
      : _baseUrl;
}
