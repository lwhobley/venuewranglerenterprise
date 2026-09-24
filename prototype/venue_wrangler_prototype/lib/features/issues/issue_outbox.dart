import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../auth/auth.dart';

enum SyncState { pending, accepted, failed }

class PendingIssueReport {
  const PendingIssueReport(
      {required this.idempotencyKey,
      required this.eventId,
      required this.venueId,
      this.locationId,
      required this.title,
      required this.description,
      required this.category,
      required this.severity,
      required this.createdAt,
      this.state = SyncState.pending});
  final String idempotencyKey;
  final String eventId;
  final String venueId;
  final String? locationId;
  final String title;
  final String description;
  final String category;
  final String severity;
  final DateTime createdAt;
  final SyncState state;
}

abstract interface class IssueOutbox {
  Future<void> enqueue(PendingIssueReport command);
  Future<List<PendingIssueReport>> pending();
  Future<void> markAccepted(String idempotencyKey);
  Future<void> markFailed(String idempotencyKey);
}

abstract interface class IssueApi {
  Future<void> create(PendingIssueReport command);
}

abstract interface class ConnectivityMonitor {
  Future<bool> get isOnline;
  Stream<bool> get changes;
}

class PluginConnectivityMonitor implements ConnectivityMonitor {
  PluginConnectivityMonitor(this._connectivity);
  final Connectivity _connectivity;

  @override
  Future<bool> get isOnline async =>
      _hasConnection(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get changes =>
      _connectivity.onConnectivityChanged.map(_hasConnection);

  static bool _hasConnection(List<ConnectivityResult> results) =>
      results.any((result) => result != ConnectivityResult.none);
}

class SecureIssueOutbox implements IssueOutbox {
  SecureIssueOutbox(this._storage);
  final FlutterSecureStorage _storage;
  static const _prefix = 'venue.issue.outbox.';

  @override
  Future<void> enqueue(PendingIssueReport command) => _storage.write(
        key: '$_prefix${command.idempotencyKey}',
        value: jsonEncode(_encode(command)),
      );

  @override
  Future<List<PendingIssueReport>> pending() async {
    final rows = await _storage.readAll();
    return rows.entries
        .where((row) => row.key.startsWith(_prefix))
        .map((row) => _decode(jsonDecode(row.value) as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  }

  @override
  Future<void> markAccepted(String idempotencyKey) =>
      _storage.delete(key: '$_prefix$idempotencyKey');

  @override
  Future<void> markFailed(String idempotencyKey) async {
    final key = '$_prefix$idempotencyKey';
    final raw = await _storage.read(key: key);
    if (raw == null) return;
    final command = _decode(jsonDecode(raw) as Map<String, dynamic>);
    await _storage.write(
        key: key, value: jsonEncode(_encode(command, SyncState.failed)));
  }

  static Map<String, Object?> _encode(PendingIssueReport item,
          [SyncState? state]) =>
      {
        'idempotencyKey': item.idempotencyKey,
        'eventId': item.eventId,
        'venueId': item.venueId,
        'locationId': item.locationId,
        'title': item.title,
        'description': item.description,
        'category': item.category,
        'severity': item.severity,
        'createdAt': item.createdAt.toUtc().toIso8601String(),
        'state': (state ?? item.state).name,
      };

  static PendingIssueReport _decode(Map<String, dynamic> value) =>
      PendingIssueReport(
        idempotencyKey: value['idempotencyKey'] as String,
        eventId: value['eventId'] as String,
        venueId: value['venueId'] as String,
        locationId: value['locationId'] as String?,
        title: value['title'] as String,
        description: value['description'] as String,
        category: value['category'] as String,
        severity: value['severity'] as String,
        createdAt: DateTime.parse(value['createdAt'] as String),
        state: SyncState.values.byName(value['state'] as String),
      );
}

class DioIssueApi implements IssueApi {
  const DioIssueApi(this._dio, this._auth);
  final Dio _dio;
  final AuthRepository _auth;

  @override
  Future<void> create(PendingIssueReport command) async {
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Sign in before synchronizing issue reports.');
    }
    await _dio.post<void>(
      '/api/v1/events/${command.eventId}/issues',
      data: {
        'title': command.title,
        'description': command.description,
        'category': command.category,
        'severity': command.severity,
        'venueId': command.venueId,
        if (command.locationId != null) 'locationId': command.locationId,
      },
      options: Options(headers: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': command.idempotencyKey
      }),
    );
  }
}

final _secureStorageProvider = Provider((ref) => const FlutterSecureStorage());
final issueOutboxProvider = Provider<IssueOutbox>(
    (ref) => SecureIssueOutbox(ref.watch(_secureStorageProvider)));
final connectivityMonitorProvider = Provider<ConnectivityMonitor>(
    (ref) => PluginConnectivityMonitor(Connectivity()));
final issueApiProvider = Provider<IssueApi>((ref) => DioIssueApi(
      Dio(BaseOptions(
          baseUrl: const String.fromEnvironment('VENUE_API_BASE_URL',
              defaultValue: 'http://localhost:3000'))),
      ref.watch(authRepositoryProvider),
    ));
final issueSyncProvider =
    StateNotifierProvider<IssueSyncController, List<PendingIssueReport>>((ref) {
  final controller = IssueSyncController(
      ref.watch(issueOutboxProvider), ref.watch(issueApiProvider));
  unawaited(controller.restore());
  controller.watchConnectivity(ref.watch(connectivityMonitorProvider));
  return controller;
});

class IssueSyncController extends StateNotifier<List<PendingIssueReport>> {
  IssueSyncController(this._outbox, this._api) : super(const []);
  final IssueOutbox _outbox;
  final IssueApi _api;
  StreamSubscription<bool>? _connectivitySubscription;
  Future<void>? _syncInFlight;
  bool _wasOnline = false;

  Future<void> restore() async => state = await _outbox.pending();

  void watchConnectivity(ConnectivityMonitor connectivity) {
    _connectivitySubscription =
        connectivity.changes.listen(_onConnectivityChanged);
    unawaited(connectivity.isOnline
        .then(_onConnectivityChanged, onError: (Object _) {}));
  }

  void _onConnectivityChanged(bool online) {
    final reconnected = online && !_wasOnline;
    _wasOnline = online;
    if (reconnected) unawaited(synchronize());
  }

  Future<void> submit(PendingIssueReport command) async {
    await _outbox.enqueue(command);
    state = [...state, command];
  }

  Future<void> synchronize() async {
    final activeSync = _syncInFlight;
    if (activeSync != null) {
      await activeSync;
      return;
    }
    final operation = _synchronizePending();
    _syncInFlight = operation;
    try {
      await operation;
    } finally {
      _syncInFlight = null;
    }
  }

  Future<void> _synchronizePending() async {
    for (final command in await _outbox.pending()) {
      try {
        await _api.create(command);
      } catch (_) {
        await _outbox.markFailed(command.idempotencyKey);
        continue;
      }
      await _outbox.markAccepted(command.idempotencyKey);
    }
    await restore();
  }

  @override
  void dispose() {
    unawaited(_connectivitySubscription?.cancel());
    super.dispose();
  }
}
