import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/auth/auth.dart';
import 'package:venue_wrangler_prototype/features/operations/operations_api.dart';

class _FixedTokenAuth extends AuthRepository {
  _FixedTokenAuth({this.scope = 'test-scope'})
      : super(Dio(), const FlutterSecureStorage());

  final String scope;

  @override
  Future<String?> validAccessToken() async => 'test-access-token';

  @override
  Future<String?> offlineCacheScope() async => scope;
}

class _SwitchableScopeAuth extends AuthRepository {
  _SwitchableScopeAuth() : super(Dio(), const FlutterSecureStorage());

  String activeScope = 'first-user';

  @override
  Future<String?> validAccessToken() async => 'test-access-token';

  @override
  Future<String?> offlineCacheScope() async => activeScope;
}

class _SseFixtureAdapter implements HttpClientAdapter {
  _SseFixtureAdapter(this.payload);

  final String payload;
  RequestOptions? lastRequest;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    lastRequest = options;
    return ResponseBody.fromString(payload, 200, headers: {
      Headers.contentTypeHeader: ['text/event-stream'],
    });
  }

  @override
  void close({bool force = false}) {}
}

class _StatusAdapter implements HttpClientAdapter {
  _StatusAdapter(this.status,
      {this.failTransport = false,
      this.failureType = DioExceptionType.connectionError,
      this.onFetch,
      this.body = ''});
  final int status;
  final bool failTransport;
  final DioExceptionType failureType;
  final void Function()? onFetch;
  final String body;
  int requests = 0;
  RequestOptions? lastRequest;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests++;
    lastRequest = options;
    onFetch?.call();
    if (failTransport) {
      throw DioException(requestOptions: options, type: failureType);
    }
    return ResponseBody.fromString(body, status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('replays authorized issue SSE frames and ignores non-issue events',
      () async {
    final adapter = _SseFixtureAdapter('''
event: heartbeat
data: {}

id: 42
event: issue
data: {"issueId":"issue-1","action":"reported"}

''');
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    final issue = await api
        .issueEvents('event-1')
        .firstWhere((event) => event['issueId'] == 'issue-1');

    expect(issue['action'], 'reported');
    expect(adapter.lastRequest?.headers['Authorization'],
        'Bearer test-access-token');
    expect(adapter.lastRequest?.headers['Last-Event-ID'], '0');
  });

  test('uses a scoped secure issue snapshot on transport failure only',
      () async {
    const eventId = '20000000-0000-4000-8000-000000000001';
    const snapshot = '[{"id":"issue-1","title":"Power loss"}]';
    const storage = FlutterSecureStorage();
    final onlineAdapter = _StatusAdapter(200, body: snapshot);
    final onlineApi = OperationsApi(_FixedTokenAuth(), storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = onlineAdapter);

    expect(await onlineApi.issues(eventId), [
      {'id': 'issue-1', 'title': 'Power loss'}
    ]);

    final offlineApi = OperationsApi(_FixedTokenAuth(), storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = _StatusAdapter(200, failTransport: true));
    expect(await offlineApi.issues(eventId), [
      {'id': 'issue-1', 'title': 'Power loss'}
    ]);
    expect(offlineApi.offlineIssueSnapshotAt(eventId), isNotNull);

    final otherUserApi = OperationsApi(
        _FixedTokenAuth(scope: 'different-user-scope'), storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = _StatusAdapter(200, failTransport: true));
    await expectLater(
        otherUserApi.issues(eventId), throwsA(isA<DioException>()));

    final unauthorizedApi = OperationsApi(_FixedTokenAuth(), storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = _StatusAdapter(401, body: '{}'));
    await expectLater(
        unauthorizedApi.issues(eventId), throwsA(isA<DioException>()));
    expect(unauthorizedApi.offlineIssueSnapshotAt(eventId), isNull);

    for (final type in [
      DioExceptionType.badCertificate,
      DioExceptionType.cancel,
      DioExceptionType.unknown,
    ]) {
      final unsafeFallbackApi = OperationsApi(_FixedTokenAuth(), storage,
          dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
            ..httpClientAdapter =
                _StatusAdapter(200, failTransport: true, failureType: type));
      await expectLater(
          unsafeFallbackApi.issues(eventId), throwsA(isA<DioException>()));
      expect(unsafeFallbackApi.offlineIssueSnapshotAt(eventId), isNull);
    }
  });

  test('discards issue responses when the account changes mid-request',
      () async {
    const eventId = '20000000-0000-4000-8000-000000000001';
    const storage = FlutterSecureStorage();
    final auth = _SwitchableScopeAuth();
    final adapter = _StatusAdapter(200,
        body: '[{"id":"issue-1"}]',
        onFetch: () => auth.activeScope = 'second-user');
    final api = OperationsApi(auth, storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = adapter);

    await expectLater(api.issues(eventId), throwsA(isA<StateError>()));
    expect(
        await storage.read(
            key: 'venue.operations.cache.first-user.issues.$eventId'),
        isNull);
  });

  test('does not read the previous account cache after a transport failure',
      () async {
    const eventId = '20000000-0000-4000-8000-000000000001';
    const storage = FlutterSecureStorage();
    await storage.write(
        key: 'venue.operations.cache.first-user.issues.$eventId',
        value: jsonEncode({
          'cachedAt': DateTime.now().toUtc().toIso8601String(),
          'value': [
            {'id': 'first-user-issue'}
          ],
        }));
    final auth = _SwitchableScopeAuth();
    final adapter = _StatusAdapter(200,
        failTransport: true, onFetch: () => auth.activeScope = 'second-user');
    final api = OperationsApi(auth, storage,
        dio: Dio(BaseOptions(baseUrl: 'https://venue.example'))
          ..httpClientAdapter = adapter);

    await expectLater(api.issues(eventId), throwsA(isA<StateError>()));
    expect(api.offlineIssueSnapshotAt(eventId), isNull);
  });

  test('submits hospitality fulfillment batches with idempotency and reasons',
      () async {
    final adapter = _StatusAdapter(204);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.hospitalityOrderAction(
      'event-1',
      'order-1',
      'fulfill',
      reason: 'Two cases remain unavailable.',
      fulfillments: [
        {
          'lineId': 'line-1',
          'quantity': 3,
          'substituteItemName': 'Still water',
          'reason': 'Sparkling stock is out.',
        }
      ],
    );

    expect(adapter.lastRequest?.data, {
      'action': 'fulfill',
      'reason': 'Two cases remain unavailable.',
      'fulfillments': [
        {
          'lineId': 'line-1',
          'quantity': 3,
          'substituteItemName': 'Still water',
          'reason': 'Sparkling stock is out.',
        }
      ],
    });
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
    expect(adapter.lastRequest?.headers['Authorization'],
        'Bearer test-access-token');
  });

  test('submits acknowledged hospitality handoff receipt with idempotency',
      () async {
    final adapter = _StatusAdapter(204);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.hospitalityOrderAction(
      'event-1',
      'order-1',
      'pickup',
      receivedByName: 'Jordan Lee',
      receiptNote: 'Suite 14 host stand',
      receiverAcknowledged: true,
    );

    expect(adapter.lastRequest?.data, {
      'action': 'pickup',
      'receivedByName': 'Jordan Lee',
      'receiptNote': 'Suite 14 host stand',
      'receiverAcknowledged': true,
    });
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test(
      'pending hospitality handoff survives reload and can be removed after acceptance',
      () async {
    const storage = FlutterSecureStorage();
    final api = OperationsApi(_FixedTokenAuth(), storage);
    final receipt = <String, Object?>{
      'receivedByName': 'Jordan Lee',
      'receiptNote': 'Suite 14 host stand',
      'receiverAcknowledged': true,
      'receiverSignature': '[[{"x":0.2,"y":0.5},{"x":0.8,"y":0.5}]]',
      'receiverPhoto': null,
    };

    await api.savePendingHospitalityHandoff('event-1', 'order-1', receipt);
    final pending = await api.pendingHospitalityHandoffs('event-1');

    expect(pending, hasLength(1));
    expect(pending.single['orderId'], 'order-1');
    expect(pending.single['receipt'], receipt);
    expect(pending.single['idempotencyKey'], isNotEmpty);
    expect(await api.pendingHospitalityHandoffs('another-event'), isEmpty);

    final handoffId = pending.single['handoffId'] as String;
    final idempotencyKey = pending.single['idempotencyKey'];
    await api.saveHospitalityHandoffPhotoEvidenceId(
        'event-1', handoffId, 'server-photo-id');
    await expectLater(
        api.savePendingHospitalityHandoff('event-1', 'order-1', receipt),
        throwsStateError);
    final resumed = await api.pendingHospitalityHandoffs('event-1');
    expect(resumed, hasLength(1));
    expect(resumed.single['idempotencyKey'], idempotencyKey);
    expect(resumed.single['photoEvidenceId'], 'server-photo-id');

    await api.deletePendingHospitalityHandoff('event-1', handoffId);
    expect(await api.pendingHospitalityHandoffs('event-1'), isEmpty);
  });

  test('replayed queued handoff uses its persisted idempotency key', () async {
    final adapter = _StatusAdapter(204);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    for (var attempt = 0; attempt < 2; attempt++) {
      await api.hospitalityOrderAction(
        'event-1',
        'order-1',
        'pickup',
        receivedByName: 'Jordan Lee',
        receiverAcknowledged: true,
        receiverSignature: 'signature-payload',
        idempotencyKeyOverride: 'stable-queued-handoff-key',
      );
      expect(adapter.lastRequest?.headers['Idempotency-Key'],
          'stable-queued-handoff-key');
    }
    expect(adapter.requests, 2);
  });

  test('submits hospitality approval action with idempotency', () async {
    final adapter = _StatusAdapter(204);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.hospitalityOrderAction(
      'event-1',
      'order-1',
      'approve',
    );

    expect(adapter.lastRequest?.data, {
      'action': 'approve',
    });
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test('creates hospitality order with BEO reference and menu item linkage',
      () async {
    final adapter = _StatusAdapter(201);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.createHospitalityOrder('event-1', {
      'venueId': 'venue-1',
      'beoReference': 'BEO-2026-99',
      'serviceAt': '2026-10-01T19:00:00.000Z',
      'lines': [
        {
          'itemName': 'Fruit platter',
          'quantity': 2,
          'unit': 'tray',
          'menuItemId': 'menu-item-1',
        }
      ],
    });

    expect(adapter.lastRequest?.data, {
      'venueId': 'venue-1',
      'beoReference': 'BEO-2026-99',
      'serviceAt': '2026-10-01T19:00:00.000Z',
      'lines': [
        {
          'itemName': 'Fruit platter',
          'quantity': 2,
          'unit': 'tray',
          'menuItemId': 'menu-item-1',
        }
      ],
    });
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test('fetches hospitality menu catalog items for venue', () async {
    final adapter = _StatusAdapter(200,
        body: jsonEncode([
          {
            'id': 'menu-item-1',
            'name': 'Fruit platter',
            'category': 'Food',
            'defaultUnit': 'tray',
            'unitPrice': 75.00,
            'isActive': true,
          }
        ]));
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    final items = await api.hospitalityMenuItems('venue-1');
    expect(items.length, 1);
    expect(items.first['name'], 'Fruit platter');
  });

  test('fetches venue stock for the hospitality recipe editor', () async {
    final adapter = _StatusAdapter(200,
        body: jsonEncode([
          {'id': 'stock-1', 'name': 'Coffee', 'unit': 'kg', 'onHand': 8.0}
        ]));
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    final items = await api.recipeInventoryItems('venue-1');

    expect(adapter.lastRequest?.path,
        '/api/v1/admin/venues/venue-1/inventory/items');
    expect(items.single['name'], 'Coffee');
  });

  test('saves an idempotent hospitality stock recipe', () async {
    final adapter = _StatusAdapter(200);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);
    final lines = [
      {'stockItemId': 'stock-1', 'quantityPerMenuUnit': 0.125},
    ];

    await api.setHospitalityMenuRecipe('venue-1', 'menu-1', lines);

    expect(adapter.lastRequest?.method, 'PUT');
    expect(adapter.lastRequest?.path,
        '/api/v1/admin/venues/venue-1/hospitality/menu-items/menu-1/recipe');
    expect(adapter.lastRequest?.data, {'lines': lines});
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test('loads event-scoped integration activity', () async {
    final adapter = _StatusAdapter(200,
        body: jsonEncode([
          {
            'source': 'arena-labor',
            'eventType': 'operations.task.upserted',
            'externalId': 'shift-42',
          }
        ]));
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    final rows = await api.integrationEvents('event-1');

    expect(adapter.lastRequest?.path, '/api/v1/integrations/events/event-1');
    expect(rows.single['source'], 'arena-labor');
  });

  test('creates venues with the configured IANA timezone', () async {
    final adapter = _StatusAdapter(201, body: '{}');
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.createVenue('North Arena', 'America/Chicago');

    expect(adapter.lastRequest?.path, '/api/v1/admin/venues');
    expect(adapter.lastRequest?.data,
        {'name': 'North Arena', 'timeZone': 'America/Chicago'});
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test('updates only the organization display name with idempotency', () async {
    final adapter = _StatusAdapter(200, body: '{}');
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    await api.updateOrganizationName('Northstar Stadium Group');

    expect(adapter.lastRequest?.method, 'PUT');
    expect(adapter.lastRequest?.path, '/api/v1/admin/organization');
    expect(adapter.lastRequest?.data, {'name': 'Northstar Stadium Group'});
    expect(adapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test('loads readiness and sends an idempotent venue lifecycle change',
      () async {
    final readinessAdapter = _StatusAdapter(200,
        body: jsonEncode({
          'venueId': 'venue-1',
          'lifecycleState': 'DRAFT',
          'timeZone': 'America/Chicago',
          'locationsCount': 1,
          'ready': true,
          'checks': [],
        }));
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = readinessAdapter;
    final api = OperationsApi(_FixedTokenAuth(), const FlutterSecureStorage(),
        dio: dio);

    final readiness = await api.venueReadiness('venue-1');
    expect(readiness['ready'], isTrue);
    expect(readinessAdapter.lastRequest?.path,
        '/api/v1/admin/venues/venue-1/readiness');
    expect(readinessAdapter.lastRequest?.headers['Authorization'],
        'Bearer test-access-token');

    final lifecycleAdapter = _StatusAdapter(200, body: '{}');
    dio.httpClientAdapter = lifecycleAdapter;
    await api.updateVenueLifecycle('venue-1', 'activate');
    expect(lifecycleAdapter.lastRequest?.method, 'PUT');
    expect(lifecycleAdapter.lastRequest?.path,
        '/api/v1/admin/venues/venue-1/lifecycle');
    expect(lifecycleAdapter.lastRequest?.data, {'action': 'activate'});
    expect(
        lifecycleAdapter.lastRequest?.headers['Idempotency-Key'], isNotEmpty);
  });

  test(
      'queues closeout summary in scoped secure storage and removes it after sync',
      () async {
    final offline = _StatusAdapter(200, failTransport: true);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = offline;
    const storage = FlutterSecureStorage();
    final api = OperationsApi(_FixedTokenAuth(), storage, dio: dio);

    expect(
        await api.saveCloseoutSummary('event-1', 'Late gate close recorded.'),
        isTrue);
    final key = 'venue.closeout.summary.outbox.test-scope.event-1';
    final queued = await storage.read(key: key);
    expect(queued, isNotNull);
    expect(queued, contains('Late gate close recorded.'));

    final online = _StatusAdapter(200);
    dio.httpClientAdapter = online;
    await api.synchronizeOfflineCloseoutSummaries();

    expect(online.requests, 1);
    expect(await storage.read(key: key), isNull);
  });

  test(
      'retains rejected offline closeout notes for review without retry looping',
      () async {
    final offline = _StatusAdapter(200, failTransport: true);
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = offline;
    const storage = FlutterSecureStorage();
    final api = OperationsApi(_FixedTokenAuth(), storage, dio: dio);
    await api.saveCloseoutSummary('event-1', 'Manager note from venue log.');

    final rejected = _StatusAdapter(409);
    dio.httpClientAdapter = rejected;
    await api.synchronizeOfflineCloseoutSummaries();
    final key = 'venue.closeout.summary.outbox.test-scope.event-1';
    final draft = await storage.read(key: key);
    expect(draft, contains('needs_review'));
    expect(draft, contains('Manager note from venue log.'));

    await api.synchronizeOfflineCloseoutSummaries();
    expect(rejected.requests, 1);
  });
}
