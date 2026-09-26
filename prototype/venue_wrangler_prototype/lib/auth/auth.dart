import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:cryptography/cryptography.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../config/api_configuration.dart';
import '../features/issues/secure_evidence_store.dart';

const oidcRedirectUri = 'com.venuewrangler.enterprise:/oauth2redirect';

bool isOfflineNetworkFailure(DioException error) =>
    error.response == null &&
    (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout);

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
    this.offlineReadOnly = false,
    this.supportVenueId,
    this.supportVenueName,
    this.supportOrganizationName,
    this.supportExpiresAt,
  });

  final String organizationSlug;
  final String providerId;
  final String accessToken;
  final DateTime expiresAt;
  final bool offlineReadOnly;
  final String? supportVenueId;
  final String? supportVenueName;
  final String? supportOrganizationName;
  final DateTime? supportExpiresAt;

  bool get supportCandidate {
    try {
      final parts = accessToken.split('.');
      if (parts.length != 3) return false;
      final claims = jsonDecode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map;
      return (claims['capabilities'] as List? ?? const [])
          .contains('support:access');
    } catch (_) {
      return false;
    }
  }

  bool get verifiedTestFixture {
    try {
      final parts = accessToken.split('.');
      if (parts.length != 3 || providerId != 'development') return false;
      final claims = jsonDecode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map;
      return claims['test_fixture_verified'] == true;
    } catch (_) {
      return false;
    }
  }
}

class AuthRepository {
  AuthRepository(this._dio, this._storage, [FlutterAppAuth? appAuth])
      : _appAuth = appAuth ?? FlutterAppAuth();

  final Dio _dio;
  final FlutterSecureStorage _storage;
  final FlutterAppAuth _appAuth;
  Future<AuthSession?>? _restoreInFlight;
  Future<AuthSession>? _tokenSaveInFlight;
  bool _offlineReadOnly = false;
  bool _signingOut = false;
  int _sessionGeneration = 0;
  String? _supportAccessToken;
  String? _supportScope;

  String? get supportAccessToken => _supportAccessToken;
  bool get supportActive => _supportAccessToken != null;

  void attachSupportHeader(Dio dio) {
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final access = _supportAccessToken;
      if (access != null && options.path.startsWith('/api/')) {
        options.headers['X-Support-Access'] = access;
      }
      handler.next(options);
    }));
  }

  bool get offlineReadOnly => _offlineReadOnly;

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
    if (supportActive) return _supportScope;
    final organization = await _storage.read(key: _organizationKey);
    final provider = await _storage.read(key: _providerKey);
    final issuer = await _storage.read(key: _issuerKey);
    final accessToken = await _storage.read(key: _accessTokenKey);
    if (organization == null ||
        provider == null ||
        (issuer == null && provider != 'development') ||
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
        'issuer': issuer ?? 'local-development',
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

  Future<AuthSession> signInDevelopment(String email, String password) async {
    if (!ApiConfiguration.isLocalDevelopment) {
      throw StateError('Development login requires a local debug build.');
    }
    final response = await _dio.post<Map<String, dynamic>>(
      '/api/v1/auth/development-login',
      data: {'email': email.trim(), 'password': password},
    );
    final result = response.data ?? const <String, dynamic>{};
    final token = result['accessToken'];
    final expiresAt = DateTime.tryParse(result['expiresAt'] as String? ?? '');
    if (token is! String ||
        expiresAt == null ||
        result['organizationSlug'] != 'venue-test-lab' ||
        result['verificationStatus'] != 'verified-test-fixture') {
      throw const FormatException('The verified test login response is incomplete.');
    }
    await _storage.write(key: _organizationKey, value: 'venue-test-lab');
    await _storage.write(key: _providerKey, value: 'development');
    await _storage.write(key: _accessTokenKey, value: token);
    await _storage.write(key: _expiresAtKey, value: expiresAt.toUtc().toIso8601String());
    for (final key in [_issuerKey, _clientIdKey, _refreshTokenKey, _idTokenKey]) {
      await _storage.delete(key: key);
    }
    _offlineReadOnly = false;
    return AuthSession(
      organizationSlug: 'venue-test-lab',
      providerId: 'development',
      accessToken: token,
      expiresAt: expiresAt.toUtc(),
    );
  }

  Future<AuthSession?> restore() async {
    if (_signingOut) return null;
    final active = _restoreInFlight;
    if (active != null) {
      final session = await active;
      return _signingOut ? null : session;
    }
    final operation = _restoreSavedSession();
    _restoreInFlight = operation;
    try {
      final session = await operation;
      return _signingOut ? null : session;
    } finally {
      if (identical(_restoreInFlight, operation)) _restoreInFlight = null;
    }
  }

  Future<AuthSession?> _restoreSavedSession() async {
    final generation = _sessionGeneration;
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
      _offlineReadOnly = false;
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
      if (_signingOut || generation != _sessionGeneration) return null;
      return await _saveTokens(organizationSlug, provider, refreshed,
          fallbackRefreshToken: refreshToken);
    } catch (error) {
      if (_signingOut || generation != _sessionGeneration) return null;
      if (_isOfflineRefreshFailure(error) &&
          expiresAt != null &&
          ApiConfiguration.offlineCacheMaxAge > Duration.zero) {
        _offlineReadOnly = true;
        return AuthSession(
          organizationSlug: organizationSlug,
          providerId: providerId,
          accessToken: accessToken,
          expiresAt: expiresAt,
          offlineReadOnly: true,
        );
      }
      await clear();
      return null;
    }
  }

  bool _isOfflineRefreshFailure(Object error) {
    if (error is DioException) return isOfflineNetworkFailure(error);
    if (error is! FlutterAppAuthPlatformException) return false;
    final details = error.platformErrorDetails;
    // AppAuth Android GeneralErrors.NETWORK_ERROR and iOS
    // OIDGeneralErrorDomain/OIDErrorCodeNetworkError. OAuth token errors use
    // different types and must clear the expired session.
    return (details.type == '0' && details.code == '3') ||
        (details.type == 'org.openid.appauth.general' && details.code == '-5');
  }

  Future<String?> validAccessToken() async {
    final session = await restore();
    if (session == null ||
        session.offlineReadOnly ||
        !session.expiresAt.isAfter(DateTime.now().toUtc())) {
      return null;
    }
    return session.accessToken;
  }

  Future<List<Map<String, dynamic>>> supportVenues() async {
    final token = await validAccessToken();
    if (token == null) {
      throw StateError('Sign in before opening support access.');
    }
    final response = await _dio.get<List<dynamic>>('/api/v1/support/venues',
        options: Options(headers: {'Authorization': 'Bearer $token'}));
    return (response.data ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList(growable: false);
  }

  Future<AuthSession> enterSupport(
      AuthSession session, String venueId, String reason) async {
    if (_supportAccessToken != null) {
      throw StateError('Exit the current support venue first.');
    }
    final token = await validAccessToken();
    if (token == null) {
      throw StateError('Sign in before opening support access.');
    }
    final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/support/access',
        data: {'venueId': venueId, 'reason': reason},
        options: Options(headers: {'Authorization': 'Bearer $token'}));
    final data = response.data ?? const <String, dynamic>{};
    final accessToken = data['accessToken'];
    final expiresAt = DateTime.tryParse(data['expiresAt'] as String? ?? '');
    if (accessToken is! String ||
        expiresAt == null ||
        data['venueId'] != venueId) {
      throw const FormatException('The support access response is incomplete.');
    }
    _supportAccessToken = accessToken;
    final scopeHash = await Sha256().hash(utf8.encode(accessToken));
    _supportScope =
        'support.${scopeHash.bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
    return AuthSession(
      organizationSlug: session.organizationSlug,
      providerId: session.providerId,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      supportVenueId: venueId,
      supportVenueName: data['venueName'] as String?,
      supportOrganizationName: data['organizationName'] as String?,
      supportExpiresAt: expiresAt.toUtc(),
    );
  }

  Future<AuthSession?> exitSupport() async {
    final access = _supportAccessToken;
    final scope = _supportScope;
    _supportAccessToken = null;
    _supportScope = null;
    if (access != null) {
      final token = await validAccessToken();
      if (token != null) {
        try {
          await _dio.post<void>('/api/v1/support/access/exit',
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'X-Support-Access': access,
              }));
        } catch (_) {
          // The local session ends immediately; the server lease expires in 15 minutes.
        }
      }
    }
    if (scope != null) {
      try {
        await _clearSupportArtifacts(scope);
      } catch (_) {
        // Local cleanup cannot prolong a support session.
      }
    }
    return restore();
  }

  Future<void> _clearSupportArtifacts(String scope) async {
    final rows = await _storage.readAll();
    final evidenceStore = SecureEvidenceStore(_storage);
    for (final row in rows.entries) {
      if (row.key.startsWith('venue.issue.outbox.')) {
        try {
          final command = jsonDecode(row.value) as Map<String, dynamic>;
          if (command['sessionScope'] != scope) continue;
          for (final raw in command['evidence'] as List? ?? const []) {
            try {
              await evidenceStore.delete(LocalIssueEvidence.fromJson(
                  Map<String, dynamic>.from(raw as Map)));
            } catch (_) {
              // The support session still ends if a local evidence file is missing.
            }
          }
          await _storage.delete(key: row.key);
        } catch (_) {
          // A corrupt local report cannot keep support access active.
        }
      } else if (row.key.contains(scope)) {
        await _storage.delete(key: row.key);
      }
    }
  }

  Future<void> signOut() async {
    if (supportActive) await exitSupport();
    _sessionGeneration++;
    _signingOut = true;
    try {
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
      final saving = _tokenSaveInFlight;
      if (saving != null) {
        try {
          await saving;
        } catch (_) {
          // A failed token write still must not prevent local sign-out.
        }
      }
      await clear();
    } finally {
      _signingOut = false;
    }
  }

  Future<void> _revokePushDevice() async {
    // Disable local delivery before attempting network cleanup. The server
    // token can be revoked after reconnect, but this device must stop treating
    // the previous account's push registration as active immediately.
    try {
      await _storage.write(key: _pushEnabledKey, value: 'false');
    } catch (_) {
      // Push cleanup must never prevent the user session from being cleared.
    }
    String? installationId;
    String? accessToken;
    try {
      installationId = await _storage.read(key: _pushInstallationKey);
      accessToken = await _storage.read(key: _accessTokenKey);
    } catch (_) {
      // Continue with Firebase token deletion when secure storage is unavailable.
    }
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
    try {
      await _storage.delete(key: _pushInstallationKey);
    } catch (_) {
      // The next sign-in still proceeds; server revocation is best-effort.
    }
  }

  Future<void> clear() async {
    _offlineReadOnly = false;
    _supportAccessToken = null;
    _supportScope = null;
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
        .where((key) => key.startsWith('venue.operations.cache.'))
        .toList()) {
      await _storage.delete(key: key);
    }
  }

  Future<AuthSession> _saveTokens(String organizationSlug,
      AuthProviderOption provider, TokenResponse? response,
      {String? fallbackRefreshToken}) async {
    final operation = _persistTokens(organizationSlug, provider, response,
        fallbackRefreshToken: fallbackRefreshToken);
    _tokenSaveInFlight = operation;
    try {
      return await operation;
    } finally {
      if (identical(_tokenSaveInFlight, operation)) _tokenSaveInFlight = null;
    }
  }

  Future<AuthSession> _persistTokens(String organizationSlug,
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
    _offlineReadOnly = false;
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
  int _generation = 0;

  Future<void> restore() async {
    final generation = _generation;
    try {
      final session = await _repository.restore();
      if (generation == _generation) state = AuthSnapshot(session: session);
    } catch (_) {
      if (generation == _generation) state = const AuthSnapshot();
    }
  }

  Future<void> signIn(
      String organizationSlug, AuthProviderOption provider) async {
    final generation = ++_generation;
    state = const AuthSnapshot.loading();
    try {
      final session = await _repository.signIn(organizationSlug, provider);
      if (generation == _generation) state = AuthSnapshot(session: session);
    } catch (_) {
      if (generation == _generation) state = const AuthSnapshot();
      rethrow;
    }
  }

  Future<void> signInDevelopment(String email, String password) async {
    final generation = ++_generation;
    state = const AuthSnapshot.loading();
    try {
      final session = await _repository.signInDevelopment(email, password);
      if (generation == _generation) state = AuthSnapshot(session: session);
    } catch (_) {
      if (generation == _generation) state = const AuthSnapshot();
      rethrow;
    }
  }

  Future<void> signOut() async {
    final generation = ++_generation;
    state = const AuthSnapshot.loading();
    await _repository.signOut();
    if (generation == _generation) state = const AuthSnapshot();
  }

  Future<void> enterSupport(String venueId, String reason) async {
    final session = state.session;
    if (session == null) {
      throw StateError('Sign in before opening support access.');
    }
    final entered = await _repository.enterSupport(session, venueId, reason);
    state = AuthSnapshot(session: entered);
  }

  Future<void> exitSupport() async {
    final session = await _repository.exitSupport();
    state = AuthSnapshot(session: session);
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
