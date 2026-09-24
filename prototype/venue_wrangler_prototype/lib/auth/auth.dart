import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:cryptography/cryptography.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../config/api_configuration.dart';

const oidcRedirectUri = 'com.venuewrangler.enterprise:/oauth2redirect';

class AuthProviderOption {
  const AuthProviderOption({
    required this.id,
    required this.name,
    required this.issuer,
    required this.clientId,
    required this.scopes,
  });

  final String id;
  final String name;
  final String issuer;
  final String clientId;
  final List<String> scopes;

  factory AuthProviderOption.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final name = json['name'];
    final issuer = json['issuer'];
    final clientId = json['clientId'];
    final scopes = json['scopes'];
    if ((id != 'okta' && id != 'entra') ||
        name is! String ||
        issuer is! String ||
        !issuer.startsWith('https://') ||
        clientId is! String ||
        clientId.isEmpty ||
        scopes is! List ||
        scopes.any((scope) => scope is! String) ||
        !scopes.contains('openid')) {
      throw const FormatException(
          'The configured sign-in provider is invalid.');
    }
    return AuthProviderOption(
      id: id as String,
      name: name,
      issuer: issuer,
      clientId: clientId,
      scopes: scopes.cast<String>(),
    );
  }
}

class AuthSession {
  const AuthSession({
    required this.organizationSlug,
    required this.providerId,
    required this.accessToken,
    required this.expiresAt,
  });

  final String organizationSlug;
  final String providerId;
  final String accessToken;
  final DateTime expiresAt;
}

class AuthRepository {
  AuthRepository(this._dio, this._storage, [FlutterAppAuth? appAuth])
      : _appAuth = appAuth ?? FlutterAppAuth();

  final Dio _dio;
  final FlutterSecureStorage _storage;
  final FlutterAppAuth _appAuth;

  static const _organizationKey = 'venue.session.organization';
  static const _providerKey = 'venue.session.provider';
  static const _issuerKey = 'venue.session.issuer';
  static const _clientIdKey = 'venue.session.client-id';
  static const _accessTokenKey = 'venue.session.access-token';
  static const _refreshTokenKey = 'venue.session.refresh-token';
  static const _idTokenKey = 'venue.session.id-token';
  static const _expiresAtKey = 'venue.session.expires-at';
  static const _pushInstallationKey = 'venue.push.installation-id';
  static const _pushEnabledKey = 'venue.push.enabled';

  Future<String?> offlineCacheScope() async {
    final organization = await _storage.read(key: _organizationKey);
    final provider = await _storage.read(key: _providerKey);
    final issuer = await _storage.read(key: _issuerKey);
    final accessToken = await _storage.read(key: _accessTokenKey);
    if (organization == null ||
        provider == null ||
        issuer == null ||
        accessToken == null) {
      return null;
    }
    try {
      final parts = accessToken.split('.');
      if (parts.length != 3) return null;
      final claims = jsonDecode(
              utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))))
          as Map<String, dynamic>;
      final subject = claims['sub'];
      if (subject is! String || subject.isEmpty) return null;
      final scope = {
        'organization': organization,
        'provider': provider,
        'issuer': issuer,
        'subject': subject,
        'tenant': claims['tenant_id'],
        'capabilities': claims['capabilities'],
        'venue_ids': claims['venue_ids'],
        'event_ids': claims['event_ids'],
        'location_ids': claims['location_ids'],
      };
      final digest = await Sha256().hash(utf8.encode(jsonEncode(scope)));
      return digest.bytes
          .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
          .join();
    } catch (_) {
      return null;
    }
  }

  Future<List<AuthProviderOption>> providersFor(String organizationSlug) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/api/v1/auth/organizations/${Uri.encodeComponent(organizationSlug)}/providers',
    );
    final rows = response.data?['providers'];
    if (rows is! List) {
      throw const FormatException('Sign-in providers are not available.');
    }
    return rows
        .map((row) => AuthProviderOption.fromJson(row as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<AuthSession> signIn(
    String organizationSlug,
    AuthProviderOption provider,
  ) async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        provider.clientId,
        oidcRedirectUri,
        issuer: provider.issuer,
        scopes: provider.scopes,
      ),
    );
    return _saveTokens(organizationSlug, provider, result);
  }

  Future<AuthSession?> restore() async {
    final organizationSlug = await _storage.read(key: _organizationKey);
    final providerId = await _storage.read(key: _providerKey);
    final accessToken = await _storage.read(key: _accessTokenKey);
    final expiresAtRaw = await _storage.read(key: _expiresAtKey);
    if (organizationSlug == null || providerId == null || accessToken == null) {
      return null;
    }
    final expiresAt = DateTime.tryParse(expiresAtRaw ?? '');
    if (expiresAt != null &&
        expiresAt
            .isAfter(DateTime.now().toUtc().add(const Duration(minutes: 1)))) {
      return AuthSession(
        organizationSlug: organizationSlug,
        providerId: providerId,
        accessToken: accessToken,
        expiresAt: expiresAt,
      );
    }

    final refreshToken = await _storage.read(key: _refreshTokenKey);
    if (refreshToken == null) {
      await clear();
      return null;
    }
    try {
      final providers = await providersFor(organizationSlug);
      final provider = providers.firstWhere((item) => item.id == providerId);
      final refreshed = await _appAuth.token(
        TokenRequest(
          provider.clientId,
          oidcRedirectUri,
          issuer: provider.issuer,
          refreshToken: refreshToken,
          scopes: provider.scopes,
        ),
      );
      return await _saveTokens(organizationSlug, provider, refreshed,
          fallbackRefreshToken: refreshToken);
    } catch (_) {
      await clear();
      return null;
    }
  }

  Future<String?> validAccessToken() async => (await restore())?.accessToken;

  Future<void> signOut() async {
    await _revokePushDevice();
    final issuer = await _storage.read(key: _issuerKey);
    final idToken = await _storage.read(key: _idTokenKey);
    if (issuer != null && idToken != null) {
      try {
        await _appAuth.endSession(
          EndSessionRequest(
            idTokenHint: idToken,
            postLogoutRedirectUrl: oidcRedirectUri,
            issuer: issuer,
          ),
        );
      } catch (_) {
        // Clear the local session even when the provider has no logout endpoint.
      }
    }
    await clear();
  }

  Future<void> _revokePushDevice() async {
    // Disable local delivery before attempting network cleanup. The server
    // token can be revoked after reconnect, but this device must stop treating
    // the previous account's push registration as active immediately.
    await _storage.write(key: _pushEnabledKey, value: 'false');
    final installationId = await _storage.read(key: _pushInstallationKey);
    final accessToken = await _storage.read(key: _accessTokenKey);
    if (installationId != null && accessToken != null) {
      try {
        await _dio.delete<void>(
          '/api/v1/me/push-devices/$installationId',
          options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
        );
      } catch (_) {
        // Clear the local session even if the device cannot reach the API to revoke its token.
      }
    }
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Firebase may be unconfigured or offline; the local session still ends.
    }
    await _storage.delete(key: _pushInstallationKey);
  }

  Future<void> clear() async {
    for (final key in [
      _organizationKey,
      _providerKey,
      _issuerKey,
      _clientIdKey,
      _accessTokenKey,
      _refreshTokenKey,
      _idTokenKey,
      _expiresAtKey,
    ]) {
      await _storage.delete(key: key);
    }
    final stored = await _storage.readAll();
    for (final key in stored.keys
        .where((key) => key.startsWith('venue.operations.cache.'))) {
      await _storage.delete(key: key);
    }
  }

  Future<AuthSession> _saveTokens(String organizationSlug,
      AuthProviderOption provider, TokenResponse? response,
      {String? fallbackRefreshToken}) async {
    final accessToken = response?.accessToken;
    final expiresAt = response?.accessTokenExpirationDateTime?.toUtc();
    if (accessToken == null || expiresAt == null) {
      throw const FormatException(
          'The identity provider returned an incomplete session.');
    }
    await _storage.write(key: _organizationKey, value: organizationSlug);
    await _storage.write(key: _providerKey, value: provider.id);
    await _storage.write(key: _issuerKey, value: provider.issuer);
    await _storage.write(key: _clientIdKey, value: provider.clientId);
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(
        key: _refreshTokenKey,
        value: response?.refreshToken ?? fallbackRefreshToken);
    await _storage.write(key: _idTokenKey, value: response?.idToken);
    await _storage.write(
        key: _expiresAtKey, value: expiresAt.toIso8601String());
    return AuthSession(
      organizationSlug: organizationSlug,
      providerId: provider.id,
      accessToken: accessToken,
      expiresAt: expiresAt,
    );
  }
}

class AuthSnapshot {
  const AuthSnapshot({
    this.loading = false,
    this.session,
  });

  const AuthSnapshot.loading() : this(loading: true);

  final bool loading;
  final AuthSession? session;
}

class AuthSessionController extends StateNotifier<AuthSnapshot> {
  AuthSessionController(this._repository) : super(const AuthSnapshot.loading());

  final AuthRepository _repository;

  Future<void> restore() async {
    try {
      state = AuthSnapshot(session: await _repository.restore());
    } catch (_) {
      state = const AuthSnapshot();
    }
  }

  Future<void> signIn(
      String organizationSlug, AuthProviderOption provider) async {
    state = const AuthSnapshot.loading();
    try {
      final session = await _repository.signIn(organizationSlug, provider);
      state = AuthSnapshot(session: session);
    } catch (_) {
      state = const AuthSnapshot();
      rethrow;
    }
  }

  Future<void> signOut() async {
    state = const AuthSnapshot.loading();
    await _repository.signOut();
    state = const AuthSnapshot();
  }
}

final authDioProvider = Provider<Dio>((ref) => Dio(BaseOptions(
      baseUrl: ApiConfiguration.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    )));

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(
      ref.watch(authDioProvider),
      const FlutterSecureStorage(),
    ));

final authSessionProvider =
    StateNotifierProvider<AuthSessionController, AuthSnapshot>((ref) {
  final controller = AuthSessionController(ref.watch(authRepositoryProvider));
  unawaited(controller.restore());
  return controller;
});
