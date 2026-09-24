import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../auth/auth.dart';
import '../../config/api_configuration.dart';
import 'secure_evidence_store.dart';

enum SyncState { pending, accepted, failed }

class PendingIssueReport {
  const PendingIssueReport(
      {required this.idempotencyKey,
      required this.eventId,
      required this.venueId,
      this.locationId,
      this.sessionScope,
      required this.title,
      required this.description,
      required this.category,
      required this.severity,
      required this.createdAt,
      this.evidence = const [],
      this.state = SyncState.pending});
  final String idempotencyKey;
  final String eventId;
  final String venueId;
  final String? locationId;
  final String? sessionScope;
  final String title;
  final String description;
  final String category;
  final String severity;
  final DateTime createdAt;
  final List<LocalIssueEvidence> evidence;
  final SyncState state;

  PendingIssueReport scopedTo(String? value) => PendingIssueReport(
        idempotencyKey: idempotencyKey,
        eventId: eventId,
        venueId: venueId,
        locationId: locationId,
        sessionScope: value,
        title: title,
        description: description,
        category: category,
        severity: severity,
        createdAt: createdAt,
        evidence: evidence,
        state: state,
      );
}

abstract interface class IssueOutbox {
  Future<void> enqueue(PendingIssueReport command);
  Future<List<PendingIssueReport>> pending();
  Future<void> markAccepted(String idempotencyKey);
  Future<void> markFailed(String idempotencyKey);
}

abstract interface class IssueApi {
  Future<String?> currentScope();
  Future<String> create(PendingIssueReport command);
  Future<void> uploadEvidence(String eventId, String issueId,
      LocalIssueEvidence evidence, List<int> bytes);
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
        'sessionScope': item.sessionScope,
        'title': item.title,
        'description': item.description,
        'category': item.category,
        'severity': item.severity,
        'createdAt': item.createdAt.toUtc().toIso8601String(),
        'evidence': item.evidence.map((item) => item.toJson()).toList(),
        'state': (state ?? item.state).name,
      };

  static PendingIssueReport _decode(Map<String, dynamic> value) =>
      PendingIssueReport(
        idempotencyKey: value['idempotencyKey'] as String,
        eventId: value['eventId'] as String,
        venueId: value['venueId'] as String,
        locationId: value['locationId'] as String?,
        sessionScope: value['sessionScope'] as String?,
        title: value['title'] as String,
        description: value['description'] as String,
        category: value['category'] as String,
        severity: value['severity'] as String,
        createdAt: DateTime.parse(value['createdAt'] as String),
        evidence: ((value['evidence'] as List<dynamic>?) ?? const [])
            .map((row) =>
                LocalIssueEvidence.fromJson(row as Map<String, dynamic>))
            .toList(),
        state: SyncState.values.byName(value['state'] as String),
      );
}

class DioIssueApi implements IssueApi {
  const DioIssueApi(this._dio, this._auth);
  final Dio _dio;
  final AuthRepository _auth;

  @override
  Future<String?> currentScope() => _auth.offlineCacheScope();

  @override
  Future<String> create(PendingIssueReport command) async {
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Sign in before synchronizing issue reports.');
    }
    final response = await _dio.post<Map<String, dynamic>>(
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
    final issue = response.data?['issue'];
    if (issue is! Map || issue['id'] is! String) {
      throw StateError('Issue API omitted the created issue ID.');
    }
    return issue['id'] as String;
  }

  @override
  Future<void> uploadEvidence(String eventId, String issueId,
      LocalIssueEvidence evidence, List<int> bytes) async {
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Sign in before uploading issue evidence.');
    }
    final headers = {'Authorization': 'Bearer $token'};
    final response = await _dio.post<Map<String, dynamic>>(
      '/api/v1/events/$eventId/issues/$issueId/evidence',
      data: {
        'clientId': evidence.clientId,
        'fileName': evidence.fileName,
        'contentType': evidence.contentType,
        'sizeBytes': evidence.sizeBytes,
        'sha256': evidence.sha256
      },
      options: Options(headers: headers),
    );
    final data = response.data;
    final attachment = data?['attachment'];
    if (attachment is! Map || attachment['id'] is! String) {
      throw StateError('Evidence API omitted the attachment ID.');
    }
    final url = data?['uploadUrl'];
    if (url is String && url.isNotEmpty) {
      final fields =
          Map<String, dynamic>.from(data?['uploadFields'] as Map? ?? const {});
      final form = FormData.fromMap({
        ...fields,
        'file': MultipartFile.fromBytes(bytes,
            filename: evidence.fileName,
            contentType: DioMediaType.parse(evidence.contentType)),
      });
      await Dio().post<void>(url, data: form);
    }
    await _dio.post<void>(
        '/api/v1/events/$eventId/issues/$issueId/evidence/${attachment['id']}/complete',
        options: Options(headers: headers));
  }
}

final _secureStorageProvider = Provider((ref) => const FlutterSecureStorage());
final issueOutboxProvider = Provider<IssueOutbox>(
    (ref) => SecureIssueOutbox(ref.watch(_secureStorageProvider)));
final connectivityMonitorProvider = Provider<ConnectivityMonitor>(
    (ref) => PluginConnectivityMonitor(Connectivity()));
final issueApiProvider = Provider<IssueApi>((ref) => DioIssueApi(
      Dio(BaseOptions(baseUrl: ApiConfiguration.baseUrl)),
      ref.watch(authRepositoryProvider),
    ));
final secureEvidenceStoreProvider =
    Provider((ref) => SecureEvidenceStore(ref.watch(_secureStorageProvider)));
final issueSyncProvider =
    StateNotifierProvider<IssueSyncController, List<PendingIssueReport>>((ref) {
  final controller = IssueSyncController(ref.watch(issueOutboxProvider),
      ref.watch(issueApiProvider), ref.watch(secureEvidenceStoreProvider));
  unawaited(controller.restore());
  controller.watchConnectivity(ref.watch(connectivityMonitorProvider));
  return controller;
});

class IssueSyncController extends StateNotifier<List<PendingIssueReport>> {
  IssueSyncController(this._outbox, this._api,
      [SecureEvidenceStore? evidenceStore])
      : _evidenceStore =
            evidenceStore ?? SecureEvidenceStore(const FlutterSecureStorage()),
        super(const []);
  final IssueOutbox _outbox;
  final IssueApi _api;
  final SecureEvidenceStore _evidenceStore;
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
    final scoped = command.scopedTo(await _api.currentScope());
    await _outbox.enqueue(scoped);
    state = [...state, scoped];
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
        if (command.sessionScope == null ||
            command.sessionScope != await _api.currentScope()) {
          await _outbox.markFailed(command.idempotencyKey);
          continue;
        }
        final issueId = await _api.create(command);
        for (final evidence in command.evidence) {
          await _api.uploadEvidence(command.eventId, issueId, evidence,
              await _evidenceStore.decrypt(evidence));
          await _evidenceStore.delete(evidence);
        }
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
