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

void main() {
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
}
