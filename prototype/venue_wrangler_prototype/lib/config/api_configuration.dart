import 'package:flutter/foundation.dart';

class ApiConfiguration {
  static const _configuredBaseUrl =
      String.fromEnvironment('VENUE_API_BASE_URL');

  static String? get error {
    if (_configuredBaseUrl.isEmpty) {
      return kReleaseMode
          ? 'This build is missing the Venue Wrangler API address. Contact your administrator.'
          : null;
    }
    final uri = Uri.tryParse(_configuredBaseUrl);
    if (uri == null || !uri.hasAuthority || uri.host.isEmpty) {
      return 'The Venue Wrangler API address in this build is invalid.';
    }
    final isLocalDevelopment =
        kDebugMode && (uri.host == 'localhost' || uri.host == '10.0.2.2');
    if (uri.scheme != 'https' && !isLocalDevelopment) {
      return 'The Venue Wrangler API must use HTTPS.';
    }
    if (uri.userInfo.isNotEmpty || uri.query.isNotEmpty || uri.fragment.isNotEmpty) {
      return 'The Venue Wrangler API address must be an origin, without credentials, query, or fragment.';
    }
    return null;
  }

  static String get baseUrl => _configuredBaseUrl.isEmpty
      ? 'http://localhost:3000'
      : _configuredBaseUrl.replaceFirst(RegExp(r'/+$'), '');
}
