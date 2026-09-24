import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/issues/issue_outbox.dart';

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
  Future<void> uploadEvidence(
          String eventId, String issueId, evidence, List<int> bytes) async =>
      throw StateError('No evidence expected.');
}
