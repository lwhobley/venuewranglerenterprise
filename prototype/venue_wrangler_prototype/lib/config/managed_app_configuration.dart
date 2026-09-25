import 'package:flutter/services.dart';

class ManagedAppConfiguration {
  const ManagedAppConfiguration({
    this.serverUrl,
    this.organizationHint,
    this.allowCameraEvidence = true,
    this.allowLocationEvidence = true,
    this.offlineCacheMaxHours = 12,
  });

  static const _channel =
      MethodChannel('app.venuewranglerenterprise/managed_configuration');

  final String? serverUrl;
  final String? organizationHint;
  final bool allowCameraEvidence;
  final bool allowLocationEvidence;
  final int offlineCacheMaxHours;

  static Future<ManagedAppConfiguration> load() async {
    try {
      final values = await _channel.invokeMapMethod<Object?, Object?>(
        'readManagedConfiguration',
      );
      return ManagedAppConfiguration.fromMap(values ?? const {});
    } on MissingPluginException {
      return const ManagedAppConfiguration();
    }
  }

  factory ManagedAppConfiguration.fromMap(Map<Object?, Object?> values) {
    String? stringValue(String key) {
      final value = values[key];
      if (value == null) return null;
      if (value is! String) {
        throw FormatException('Managed setting "$key" must be a string.');
      }
      return value;
    }

    bool boolValue(String key, {required bool fallback}) {
      final value = values[key];
      if (value == null) return fallback;
      if (value is! bool) {
        throw FormatException('Managed setting "$key" must be a boolean.');
      }
      return value;
    }

    final cacheHoursValue = values['offline_cache_max_hours'];
    final cacheHours = switch (cacheHoursValue) {
      null => 12,
      int value when value >= 0 && value <= 12 => value,
      _ => throw const FormatException(
          'Managed setting "offline_cache_max_hours" must be an integer from 0 to 12.'),
    };
    final serverUrl = stringValue('server_url');
    if (serverUrl != null && serverUrl.trim().isEmpty) {
      throw const FormatException('Managed setting "server_url" is empty.');
    }
    final organizationHint = stringValue('organization_hint');

    return ManagedAppConfiguration(
      serverUrl: serverUrl?.trim(),
      organizationHint: organizationHint?.trim().isEmpty == true
          ? null
          : organizationHint?.trim(),
      allowCameraEvidence: boolValue('allow_camera_evidence', fallback: true),
      allowLocationEvidence:
          boolValue('allow_location_evidence', fallback: true),
      offlineCacheMaxHours: cacheHours,
    );
  }
}
