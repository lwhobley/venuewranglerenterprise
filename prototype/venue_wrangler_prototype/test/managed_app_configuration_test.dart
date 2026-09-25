import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/config/managed_app_configuration.dart';

void main() {
  test('uses permissive evidence defaults and a 12 hour read cache', () {
    final config = ManagedAppConfiguration.fromMap(const {});

    expect(config.serverUrl, isNull);
    expect(config.organizationHint, isNull);
    expect(config.allowCameraEvidence, isTrue);
    expect(config.allowLocationEvidence, isTrue);
    expect(config.offlineCacheMaxHours, 12);
  });

  test('reads the supported managed app configuration values', () {
    final config = ManagedAppConfiguration.fromMap({
      'server_url': 'https://api.venue.example.com/',
      'organization_hint': 'arena-ops',
      'allow_camera_evidence': false,
      'allow_location_evidence': false,
      'offline_cache_max_hours': 0,
    });

    expect(config.serverUrl, 'https://api.venue.example.com/');
    expect(config.organizationHint, 'arena-ops');
    expect(config.allowCameraEvidence, isFalse);
    expect(config.allowLocationEvidence, isFalse);
    expect(config.offlineCacheMaxHours, 0);
  });

  test('rejects invalid managed types and cache limits', () {
    expect(
      () => ManagedAppConfiguration.fromMap({'server_url': 42}),
      throwsFormatException,
    );
    expect(
      () => ManagedAppConfiguration.fromMap({'allow_camera_evidence': 'false'}),
      throwsFormatException,
    );
    expect(
      () => ManagedAppConfiguration.fromMap({'offline_cache_max_hours': 13}),
      throwsFormatException,
    );
    expect(
      () => ManagedAppConfiguration.fromMap({'offline_cache_max_hours': -1}),
      throwsFormatException,
    );
    expect(
      () => ManagedAppConfiguration.fromMap({'server_url': '  '}),
      throwsFormatException,
    );
  });
}
