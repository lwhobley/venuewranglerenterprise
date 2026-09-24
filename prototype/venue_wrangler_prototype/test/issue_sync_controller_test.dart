import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/issues/issue_outbox.dart';

void main() {
  test(
      'retries queued reports after connectivity returns and keeps failures for another reconnect',
      () async {
    final outbox = _FakeOutbox()..items.add(_pendingReport());
    final api = _FakeIssueApi()..failuresRemaining = 1;
    final connectivity = _FakeConnectivity();
    final controller = IssueSyncController(outbox, api)
      ..watchConnectivity(connectivity);
    addTearDown(() {
      controller.dispose();
      connectivity.close();
    });

    await controller.restore();
    connectivity.emit(true);
    await _settleAsyncWork();
    expect(api.attempts, 1);
    expect(outbox.items.single.state, SyncState.failed);
    expect(controller.state.single.state, SyncState.failed);

    connectivity.emit(false);
    connectivity.emit(true);
    connectivity.emit(true);
    await _settleAsyncWork();
    expect(api.attempts, 2,
        reason:
            'Repeated online signals must not submit the same report concurrently.');
    expect(outbox.items, isEmpty);
    expect(controller.state, isEmpty);
  });

  test(
      'checks connectivity on startup and retries already queued reports when online',
      () async {
    final outbox = _FakeOutbox()..items.add(_pendingReport());
    final api = _FakeIssueApi();
    final connectivity = _FakeConnectivity(initiallyOnline: true);
    final controller = IssueSyncController(outbox, api)
      ..watchConnectivity(connectivity);
    addTearDown(() {
      controller.dispose();
      connectivity.close();
    });

    await _settleAsyncWork();
    expect(api.attempts, 1);
    expect(outbox.items, isEmpty);
  });
}

Future<void> _settleAsyncWork() async {
  await Future<void>.delayed(const Duration(milliseconds: 30));
}

PendingIssueReport _pendingReport({SyncState state = SyncState.pending}) =>
    PendingIssueReport(
      idempotencyKey: 'test-key-00000001',
      eventId: '20000000-0000-4000-8000-000000000001',
      venueId: '10000000-0000-4000-8000-000000000001',
      locationId: '30000000-0000-4000-8000-000000000001',
      title: 'Ice machine stopped',
      description: 'The east bar ice machine has stopped.',
      category: 'Service',
      severity: 'MODERATE',
      createdAt: DateTime.utc(2026, 9, 23),
      sessionScope: 'test-scope',
      state: state,
    );

class _FakeOutbox implements IssueOutbox {
  final List<PendingIssueReport> items = [];

  @override
  Future<void> enqueue(PendingIssueReport command) async => items.add(command);

  @override
  Future<void> markAccepted(String idempotencyKey) async {
    items.removeWhere((item) => item.idempotencyKey == idempotencyKey);
  }

  @override
  Future<void> markFailed(String idempotencyKey) async {
    final index =
        items.indexWhere((item) => item.idempotencyKey == idempotencyKey);
    if (index >= 0) items[index] = _pendingReport(state: SyncState.failed);
  }

  @override
  Future<List<PendingIssueReport>> pending() async => List.unmodifiable(items);
}

class _FakeIssueApi implements IssueApi {
  int attempts = 0;
  int failuresRemaining = 0;

  @override
  Future<String?> currentScope() async => 'test-scope';

  @override
  Future<String> create(PendingIssueReport command) async {
    attempts++;
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw StateError('Temporary network failure');
    }
    return 'fake-issue';
  }

  @override
  Future<void> uploadEvidence(
      String eventId, String issueId, evidence, List<int> bytes) async {}
}

class _FakeConnectivity implements ConnectivityMonitor {
  _FakeConnectivity({bool initiallyOnline = false})
      : _initiallyOnline = initiallyOnline;
  final bool _initiallyOnline;
  final StreamController<bool> _changes = StreamController<bool>.broadcast();

  @override
  Future<bool> get isOnline async => _initiallyOnline;

  @override
  Stream<bool> get changes => _changes.stream;

  void emit(bool online) => _changes.add(online);
  Future<void> close() => _changes.close();
}
