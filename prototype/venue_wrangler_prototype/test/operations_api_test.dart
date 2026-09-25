import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/auth/auth.dart';
import 'package:venue_wrangler_prototype/features/operations/operations_api.dart';

class _FixedTokenAuth extends AuthRepository {
  _FixedTokenAuth() : super(Dio(), const FlutterSecureStorage());

  @override
  Future<String?> validAccessToken() async => 'test-access-token';

  @override
  Future<String?> offlineCacheScope() async => 'test-scope';
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
  _StatusAdapter(this.status, {this.failTransport = false});
  final int status;
  final bool failTransport;
  int requests = 0;
  RequestOptions? lastRequest;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests++;
    lastRequest = options;
    if (failTransport) throw DioException(requestOptions: options);
    return ResponseBody.fromString('', status);
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
