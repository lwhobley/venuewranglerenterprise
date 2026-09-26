import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/auth/auth.dart';
import 'package:venue_wrangler_prototype/features/issues/issue_outbox.dart';
import 'package:venue_wrangler_prototype/features/issues/secure_evidence_store.dart';

void main() {
  test('an issue report is persisted locally before network synchronization',
      () async {
    final outbox = _MemoryOutbox();
    final controller = IssueSyncController(outbox, _NeverCalledIssueApi());
    addTearDown(controller.dispose);
    final report = PendingIssueReport(
      idempotencyKey: 'report-key-00000001',
      eventId: '20000000-0000-4000-8000-000000000001',
      venueId: '10000000-0000-4000-8000-000000000001',
      title: 'Ice machine stopped',
      description: 'The east bar ice machine stopped.',
      category: 'Service',
      severity: 'MODERATE',
      createdAt: DateTime.utc(2026, 9, 24),
    );

    await controller.submit(report);

    expect(outbox.rows, hasLength(1));
    expect(outbox.rows.single.idempotencyKey, report.idempotencyKey);
    expect(outbox.rows.single.sessionScope, 'test-scope');
    expect(controller.state.single.sessionScope, 'test-scope');
  });

  test('does not send a saved report or photo with another user token',
      () async {
    final auth = _SwitchedAuth();
    final adapter = _CountingAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://venue.example'))
      ..httpClientAdapter = adapter;
    final api = DioIssueApi(dio, auth);
    final report = PendingIssueReport(
      idempotencyKey: 'report-key-00000002',
      eventId: '20000000-0000-4000-8000-000000000001',
      venueId: '10000000-0000-4000-8000-000000000001',
      title: 'Power failure',
      description: 'The event floor has lost power.',
      category: 'Operations',
      severity: 'HIGH',
      createdAt: DateTime.utc(2026, 9, 24),
      sessionScope: 'previous-user-scope',
    );
    final evidence = LocalIssueEvidence(
      clientId: '40000000-0000-4000-8000-000000000001',
      encryptedPath: 'unused',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 3,
      sha256: 'unused',
    );

    await expectLater(api.create(report), throwsA(isA<StateError>()));
    await expectLater(
      api.uploadEvidence(
          report.eventId, 'issue-1', evidence, [1, 2, 3], report.sessionScope!),
      throwsA(isA<StateError>()),
    );
    expect(adapter.requests, 0);
  });
}

class _SwitchedAuth extends AuthRepository {
  _SwitchedAuth() : super(Dio(), const FlutterSecureStorage());

  @override
  Future<String?> validAccessToken() async => 'another-user-token';

  @override
  Future<String?> offlineCacheScope() async => 'current-user-scope';
}

class _CountingAdapter implements HttpClientAdapter {
  int requests = 0;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests++;
    throw StateError('A cross-user request reached the network.');
  }

  @override
  void close({bool force = false}) {}
}

class _MemoryOutbox implements IssueOutbox {
  final rows = <PendingIssueReport>[];

  @override
  Future<void> enqueue(PendingIssueReport command) async => rows.add(command);

  @override
  Future<List<PendingIssueReport>> pending() async => List.unmodifiable(rows);

  @override
  Future<void> markAccepted(String idempotencyKey) async =>
      rows.removeWhere((row) => row.idempotencyKey == idempotencyKey);

  @override
  Future<void> markFailed(String idempotencyKey) async {}
}

class _NeverCalledIssueApi implements IssueApi {
  @override
  Future<String?> currentScope() async => 'test-scope';

  @override
  Future<String> create(PendingIssueReport command) async =>
      throw StateError('Offline report should not sync during submission.');

  @override
  Future<void> uploadEvidence(String eventId, String issueId, evidence,
          List<int> bytes, String sessionScope) async =>
      throw StateError('No evidence expected.');
}
