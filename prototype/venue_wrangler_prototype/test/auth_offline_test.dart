import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/auth/auth.dart';
import 'package:venue_wrangler_prototype/features/operations/operations_api.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues(_expiredSession()));

  test('expired SSO session keeps scoped cached issues readable offline',
      () async {
    final adapter = _ProviderAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    const storage = FlutterSecureStorage();
    final auth = AuthRepository(dio, storage);
    final scope = await auth.offlineCacheScope();
    const eventId = '20000000-0000-4000-8000-000000000001';
    await storage.write(
        key: 'venue.operations.cache.$scope.issues.$eventId',
        value: jsonEncode({
          'cachedAt': DateTime.now().toUtc().toIso8601String(),
          'value': [
            {'id': 'issue-1', 'title': 'Power loss'}
          ],
        }));

    final sessions = await Future.wait([auth.restore(), auth.restore()]);
    expect(
        sessions.every((session) => session?.offlineReadOnly == true), isTrue);
    expect(adapter.requests, 1, reason: 'Refresh checks share one flight.');
    expect(await auth.validAccessToken(), isNull);
    expect(await storage.read(key: 'venue.session.access-token'), isNotNull);

    final operations = OperationsApi(auth, storage, dio: dio);
    expect(await operations.issues(eventId), [
      {'id': 'issue-1', 'title': 'Power loss'}
    ]);
    expect(operations.offlineIssueSnapshotAt(eventId), isNotNull);
    expect(adapter.paths.every((path) => path.contains('/auth/')), isTrue,
        reason: 'An expired access token must not be sent to the issue API.');
  });

  test('identity provider rejection clears the expired session and cache',
      () async {
    final adapter = _ProviderAdapter(responseStatus: 401);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    const storage = FlutterSecureStorage();
    final auth = AuthRepository(dio, storage);
    final scope = await auth.offlineCacheScope();
    await storage.write(
        key: 'venue.operations.cache.$scope.bootstrap',
        value: '{"cachedAt":"2026-09-26T00:00:00Z","value":{}}');

    expect(await auth.restore(), isNull);
    expect(auth.offlineReadOnly, isFalse);
    expect(await storage.read(key: 'venue.session.access-token'), isNull);
    expect(await storage.read(key: 'venue.operations.cache.$scope.bootstrap'),
        isNull);
  });

  test('certificate failure does not unlock the expired offline session',
      () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter =
          _ProviderAdapter(failureType: DioExceptionType.badCertificate);
    const storage = FlutterSecureStorage();
    final auth = AuthRepository(dio, storage);

    expect(await auth.restore(), isNull);
    expect(await storage.read(key: 'venue.session.access-token'), isNull);
  });

  for (final details in [
    FlutterAppAuthPlatformErrorDetails(type: '0', code: '3'),
    FlutterAppAuthPlatformErrorDetails(
        type: 'org.openid.appauth.general', code: '-5'),
  ]) {
    test('native AppAuth network error ${details.type} keeps offline cache',
        () async {
      final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
        ..httpClientAdapter = _ProviderAdapter(responseStatus: 200);
      const storage = FlutterSecureStorage();
      final auth = AuthRepository(dio, storage, _FailingAppAuth(details));

      final session = await auth.restore();
      expect(session?.offlineReadOnly, isTrue);
      expect(await auth.validAccessToken(), isNull);
      expect(await storage.read(key: 'venue.session.access-token'), isNotNull);
    });
  }

  test('native AppAuth OAuth token rejection clears expired session', () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = _ProviderAdapter(responseStatus: 200);
    const storage = FlutterSecureStorage();
    final auth = AuthRepository(
      dio,
      storage,
      _FailingAppAuth(FlutterAppAuthPlatformErrorDetails(
          type: '2', code: '2002', error: 'invalid_grant')),
    );

    expect(await auth.restore(), isNull);
    expect(await storage.read(key: 'venue.session.access-token'), isNull);
  });

  test('sign-out wins over a refresh already in flight', () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = _ProviderAdapter(responseStatus: 200);
    const storage = FlutterSecureStorage();
    final appAuth = _ControlledAppAuth();
    final auth = AuthRepository(dio, storage, appAuth);

    final restoring = auth.restore();
    await appAuth.started.future;
    final signingOut = auth.signOut();
    await signingOut;
    expect(await storage.read(key: 'venue.session.access-token'), isNull);
    expect(await storage.read(key: 'venue.session.refresh-token'), isNull);
    appAuth.complete();
    expect(await restoring, isNull);
    expect(await storage.read(key: 'venue.session.access-token'), isNull);
  });
}

Map<String, String> _expiredSession() {
  final payload = base64Url
      .encode(utf8.encode(jsonEncode({
        'sub': 'worker-1',
        'capabilities': ['issue:read'],
        'venue_ids': ['10000000-0000-4000-8000-000000000001'],
        'event_ids': ['20000000-0000-4000-8000-000000000001'],
        'location_ids': <String>[],
      })))
      .replaceAll('=', '');
  return {
    'venue.session.organization': 'harbor-city',
    'venue.session.provider': 'okta',
    'venue.session.issuer': 'https://idp.example/oauth2/default',
    'venue.session.client-id': 'native-client',
    'venue.session.access-token': 'header.$payload.signature',
    'venue.session.refresh-token': 'saved-refresh-token',
    'venue.session.expires-at': DateTime.now()
        .toUtc()
        .subtract(const Duration(minutes: 1))
        .toIso8601String(),
  };
}

class _ProviderAdapter implements HttpClientAdapter {
  _ProviderAdapter(
      {this.responseStatus,
      this.failureType = DioExceptionType.connectionError});

  final int? responseStatus;
  final DioExceptionType failureType;
  final List<String> paths = [];
  int requests = 0;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests++;
    paths.add(options.path);
    if (responseStatus == null) {
      throw DioException(requestOptions: options, type: failureType);
    }
    return ResponseBody.fromString(
        responseStatus == 200
            ? jsonEncode({
                'providers': [
                  {
                    'id': 'okta',
                    'name': 'Okta',
                    'issuer': 'https://idp.example/oauth2/default',
                    'clientId': 'native-client',
                    'scopes': ['openid', 'offline_access'],
                  }
                ]
              })
            : '{}',
        responseStatus!,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        });
  }

  @override
  void close({bool force = false}) {}
}

class _FailingAppAuth extends FlutterAppAuth {
  const _FailingAppAuth(this.details);

  final FlutterAppAuthPlatformErrorDetails details;

  @override
  Future<TokenResponse> token(TokenRequest request) async {
    throw FlutterAppAuthPlatformException(
      code: 'token_failed',
      platformErrorDetails: details,
    );
  }
}

class _ControlledAppAuth extends FlutterAppAuth {
  final started = Completer<void>();
  final _response = Completer<TokenResponse>();

  @override
  Future<TokenResponse> token(TokenRequest request) {
    started.complete();
    return _response.future;
  }

  void complete() {
    _response.complete(TokenResponse(
      'new-access-token',
      'new-refresh-token',
      DateTime.now().toUtc().add(const Duration(hours: 1)),
      null,
      'Bearer',
      const ['openid'],
      null,
    ));
  }
}
