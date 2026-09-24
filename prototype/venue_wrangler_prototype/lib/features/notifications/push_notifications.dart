import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../operations/operations_api.dart';

class PushNotifications {
  PushNotifications._();

  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const _senderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _enabledKey = 'venue.push.enabled';
  static const _installationKey = 'venue.push.installation-id';
  static const _storage = FlutterSecureStorage();
  static Future<bool>? _initializing;
  static StreamSubscription<String>? _tokenRefresh;

  static bool get isConfigured =>
      _apiKey.isNotEmpty &&
      _appId.isNotEmpty &&
      _senderId.isNotEmpty &&
      _projectId.isNotEmpty;

  static Future<bool> initialize() => _initializing ??= _initialize();

  static Future<bool> _initialize() async {
    if (!isConfigured || kIsWeb) {
      return false;
    }
    if (defaultTargetPlatform != TargetPlatform.iOS &&
        defaultTargetPlatform != TargetPlatform.android) return false;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: _apiKey,
            appId: _appId,
            messagingSenderId: _senderId,
            projectId: _projectId,
            iosBundleId: defaultTargetPlatform == TargetPlatform.iOS
                ? 'com.venuewrangler.enterprise'
                : null,
          ),
        );
      }
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
          alert: true,
          badge: true,
          sound: true,
        );
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> isEnabled() async =>
      await _storage.read(key: _enabledKey) == 'true';

  static Future<bool> enable(OperationsApi api) async {
    if (!await initialize()) return false;
    final permission = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (permission.authorizationStatus != AuthorizationStatus.authorized &&
        permission.authorizationStatus != AuthorizationStatus.provisional) {
      return false;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      String? apnsToken;
      for (var attempt = 0; attempt < 10 && apnsToken == null; attempt += 1) {
        apnsToken = await FirebaseMessaging.instance.getAPNSToken();
        if (apnsToken == null) await Future<void>.delayed(const Duration(milliseconds: 500));
      }
      if (apnsToken == null) return false;
    }
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null || token.length < 32) return false;
    final installationId = await _installationId();
    await api.registerPushDevice(
      installationId: installationId,
      platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      registrationToken: token,
    );
    await _storage.write(key: _enabledKey, value: 'true');
    _listenForRefresh(api, installationId);
    return true;
  }

  static Future<void> syncIfEnabled(OperationsApi api) async {
    if (!await isEnabled() || !await initialize()) return;
    final installationId = await _installationId();
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await api.registerPushDevice(
          installationId: installationId,
          platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
          registrationToken: token,
        );
        _listenForRefresh(api, installationId);
      }
    } catch (_) {
      // The durable in-app inbox remains available when push registration is offline.
    }
  }

  static Future<void> disable(OperationsApi api) async {
    final installationId = await _storage.read(key: _installationKey);
    await _storage.write(key: _enabledKey, value: 'false');
    await _tokenRefresh?.cancel();
    _tokenRefresh = null;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Keep the device disabled locally even when its network is unavailable.
    }
    if (installationId != null) await api.revokePushDevice(installationId);
  }

  static Future<String> _installationId() async {
    final existing = await _storage.read(key: _installationKey);
    if (existing != null) return existing;
    final created = const Uuid().v4();
    await _storage.write(key: _installationKey, value: created);
    return created;
  }

  static void _listenForRefresh(OperationsApi api, String installationId) {
    _tokenRefresh ??= FirebaseMessaging.instance.onTokenRefresh.listen((token) {
      api.registerPushDevice(
        installationId: installationId,
        platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
        registrationToken: token,
      ).catchError((Object _) {});
    });
  }
}
