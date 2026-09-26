import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';
import '../../auth/auth.dart';
import '../../config/api_configuration.dart';
import '../issues/secure_evidence_store.dart';

class _OfflineAccessTokenUnavailable extends StateError {
  _OfflineAccessTokenUnavailable()
      : super('Connect to your identity provider before using the API.');
}

class OperationsApi {
  OperationsApi(this._auth, this._storage, {Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: ApiConfiguration.baseUrl));
  final AuthRepository _auth;
  final FlutterSecureStorage _storage;
  final Dio _dio;
  final Map<String, DateTime> _offlineCacheHits = {};

  static const _cachePrefix = 'venue.operations.cache.';
  static const _maxCacheBytes = 256 * 1024;

  DateTime? offlineIssueSnapshotAt(String eventId) =>
      _offlineCacheHits['issues.$eventId'];

  Future<T> _cachedGet<T>(String cacheKey, Future<T> Function() load) async {
    final maxCacheAge = ApiConfiguration.offlineCacheMaxAge;
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return load();
    final storageKey = '$_cachePrefix$scope.$cacheKey';
    try {
      final value = await load();
      if (scope != await _auth.offlineCacheScope()) {
        throw StateError('The signed-in account changed during this request.');
      }
      _offlineCacheHits.remove(cacheKey);
      final encoded = jsonEncode({
        'cachedAt': DateTime.now().toUtc().toIso8601String(),
        'value': value
      });
      if (maxCacheAge > Duration.zero &&
          utf8.encode(encoded).length <= _maxCacheBytes) {
        await _storage.write(key: storageKey, value: encoded);
        if (scope != await _auth.offlineCacheScope()) {
          throw StateError(
              'The signed-in account changed during this request.');
        }
      }
      return value;
    } catch (error) {
      if (error is! _OfflineAccessTokenUnavailable &&
          (error is! DioException || !isOfflineNetworkFailure(error))) {
        rethrow;
      }
      if (scope != await _auth.offlineCacheScope()) {
        throw StateError('The signed-in account changed during this request.');
      }
      final encoded = await _storage.read(key: storageKey);
      if (scope != await _auth.offlineCacheScope()) {
        throw StateError('The signed-in account changed during this request.');
      }
      if (encoded != null) {
        final snapshot = jsonDecode(encoded) as Map<String, dynamic>;
        final cachedAt =
            DateTime.tryParse(snapshot['cachedAt'] as String? ?? '');
        final age = cachedAt == null
            ? null
            : DateTime.now().toUtc().difference(cachedAt);
        if (maxCacheAge > Duration.zero &&
            age != null &&
            age >= Duration.zero &&
            age <= maxCacheAge) {
          _offlineCacheHits[cacheKey] = cachedAt!;
          return snapshot['value'] as T;
        }
      }
      _offlineCacheHits.remove(cacheKey);
      rethrow;
    }
  }

  Future<Response<T>> _request<T>(
      Future<Response<T>> Function(String token) call) async {
    final token = await _auth.validAccessToken();
    if (token == null) {
      if (_auth.offlineReadOnly) throw _OfflineAccessTokenUnavailable();
      throw StateError('Sign in again to continue.');
    }
    return call(token);
  }

  Future<T> _command<T>(Map<String, Object?> command,
      Future<T> Function(String token, String idempotencyKey) send,
      {String? idempotencyKeyOverride}) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    final scope = await _auth.offlineCacheScope();
    final digest = await Sha256().hash(utf8.encode(jsonEncode(command)));
    final commandHash = digest.bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    final storageKey =
        scope == null ? null : 'venue.operations.command.$scope.$commandHash';
    String? idempotencyKey = idempotencyKeyOverride;
    if (idempotencyKey == null && storageKey != null) {
      try {
        idempotencyKey = await _storage.read(key: storageKey);
      } catch (_) {
        // Continue with an in-memory key if secure storage is unavailable.
      }
    }
    idempotencyKey ??= const Uuid().v4();
    if (idempotencyKeyOverride == null && storageKey != null) {
      try {
        await _storage.write(key: storageKey, value: idempotencyKey);
      } catch (_) {
        // The request remains usable; persistence improves retry safety.
      }
    }
    final result = await send(token, idempotencyKey);
    if (idempotencyKeyOverride == null && storageKey != null) {
      try {
        await _storage.delete(key: storageKey);
      } catch (_) {
        // Cleanup must not turn an accepted command into a reported failure.
      }
    }
    return result;
  }

  Future<Map<String, dynamic>> bootstrap() => _cachedGet(
      'bootstrap',
      () async => (await _request((token) => _dio.get<Map<String, dynamic>>(
              '/api/v1/me',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data!);
  Future<List<dynamic>> issues(String eventId) => _cachedGet(
      'issues.$eventId',
      () async =>
          (await _request((token) => _dio.get<List<dynamic>>(
                  '/api/v1/events/$eventId/issues',
                  options:
                      Options(headers: {'Authorization': 'Bearer $token'}))))
              .data ??
          const []);
  Stream<Map<String, dynamic>> issueEvents(String eventId) async* {
    var cursor = '0';
    var retryDelay = const Duration(seconds: 1);
    while (true) {
      final token = await _auth.validAccessToken();
      if (token == null) {
        yield* Stream<Map<String, dynamic>>.error(
            StateError('Sign in again to receive live updates.'));
        return;
      }
      try {
        final response = await _dio.get<ResponseBody>(
          '/api/v1/events/$eventId/issues/stream',
          options: Options(
            responseType: ResponseType.stream,
            receiveTimeout: Duration.zero,
            headers: {
              'Authorization': 'Bearer $token',
              'Last-Event-ID': cursor,
              'Accept': 'text/event-stream',
            },
          ),
        );
        yield const {'_connected': true};
        String? frameId;
        String? eventType;
        final dataLines = <String>[];
        final lines = response.data!.stream
            .cast<List<int>>()
            .transform(utf8.decoder)
            .transform(const LineSplitter());
        await for (final line in lines) {
          if (line.isEmpty) {
            if (dataLines.isNotEmpty) {
              final rawData = dataLines.join('\n');
              try {
                final decoded = jsonDecode(rawData);
                if (decoded is Map<String, dynamic> &&
                    (eventType == null || eventType == 'issue')) {
                  if (frameId != null && RegExp(r'^\d+$').hasMatch(frameId)) {
                    cursor = frameId;
                  }
                  yield decoded;
                }
              } on FormatException {
                // Ignore a malformed frame and keep the connection alive.
              }
            }
            frameId = null;
            eventType = null;
            dataLines.clear();
            continue;
          }
          if (line.startsWith(':')) continue;
          final separator = line.indexOf(':');
          final field = separator < 0 ? line : line.substring(0, separator);
          var value = separator < 0 ? '' : line.substring(separator + 1);
          if (value.startsWith(' ')) value = value.substring(1);
          switch (field) {
            case 'id':
              if (!value.contains('\u0000')) frameId = value;
              break;
            case 'event':
              eventType = value;
              break;
            case 'data':
              dataLines.add(value);
              break;
          }
        }
        retryDelay = const Duration(seconds: 1);
        yield const {'_connected': false};
      } catch (error, stackTrace) {
        final status =
            error is DioException ? error.response?.statusCode : null;
        if (status == 401 || status == 403 || error is StateError) {
          yield* Stream<Map<String, dynamic>>.error(error, stackTrace);
          return;
        }
        yield const {'_connected': false};
      }
      await Future<void>.delayed(retryDelay);
      retryDelay =
          Duration(seconds: (retryDelay.inSeconds * 2).clamp(1, 30).toInt());
    }
  }

  Future<List<dynamic>> tasks(String eventId) => _cachedGet(
      'tasks.$eventId',
      () async =>
          (await _request((token) => _dio.get<List<dynamic>>(
                  '/api/v1/events/$eventId/tasks',
                  options:
                      Options(headers: {'Authorization': 'Bearer $token'}))))
              .data ??
          const []);
  Future<List<dynamic>> integrationEvents(String eventId) async {
    final response = await _request((token) => _dio.get<List<dynamic>>(
          '/api/v1/integrations/events/$eventId',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
    return response.data ?? const [];
  }

  Future<List<Map<String, dynamic>>> integrationSources() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/integrations/sources',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> pollIntegrationSource(String sourceId) async => _request(
      (token) => _dio.post<void>('/api/v1/integrations/sources/$sourceId/poll',
          options: Options(headers: {'Authorization': 'Bearer $token'})));

  Future<List<Map<String, dynamic>>> integrationDeadLetters(
          String sourceId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/integrations/sources/$sourceId/dead-letters',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> replayIntegrationDeadLetter(String letterId) async => _request(
      (token) => _dio.post<void>(
          '/api/v1/integrations/dead-letters/$letterId/replay',
          options: Options(headers: {'Authorization': 'Bearer $token'})));

  Future<List<Map<String, dynamic>>> integrationTransforms() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/integrations/transforms',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> saveIntegrationTransform(
      String source, Map<String, dynamic> definition) async {
    await _request((token) => _dio.post<void>(
          '/api/v1/integrations/transforms',
          data: {'source': source, 'definition': definition},
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
  }

  Future<Map<String, dynamic>> previewRawIntegration(String source,
          Map<String, dynamic> definition, Map<String, dynamic> record) async =>
      (await _request((token) => _dio.post<Map<String, dynamic>>(
                '/api/v1/integrations/transforms/preview',
                data: {
                  'source': source,
                  'definition': definition,
                  'record': record
                },
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<List<Map<String, dynamic>>> integrationIdentifiers() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/integrations/identifiers',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> putIntegrationIdentifier(Map<String, String> mapping) async {
    await _request((token) => _dio.put<void>(
          '/api/v1/integrations/identifiers',
          data: mapping,
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
  }

  Future<Map<String, dynamic>> integrationIdentifierImpact(
          String mappingId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/integrations/identifiers/$mappingId/impact',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<void> correctIntegrationIdentifier(
      String mappingId, Map<String, Object?> correction) async {
    await _request((token) => _dio.put<void>(
          '/api/v1/integrations/identifiers/$mappingId/correct',
          data: correction,
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
  }

  Future<Map<String, dynamic>> previewIntegrationEvent(
          String source, Map<String, dynamic> event) async =>
      (await _request((token) => _dio.post<Map<String, dynamic>>(
                '/api/v1/integrations/preview',
                data: {'source': source, 'event': event},
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<Map<String, dynamic>> eventCloseout(String eventId) async {
    final response = await _cachedGet<Map<String, dynamic>>(
      'closeout.$eventId',
      () async =>
          (await _request((token) => _dio.get<Map<String, dynamic>>(
                  '/api/v1/events/$eventId/closeout',
                  options:
                      Options(headers: {'Authorization': 'Bearer $token'}))))
              .data ??
          const {},
    );
    final data = Map<String, dynamic>.from(response);
    final scope = await _auth.offlineCacheScope();
    if (scope != null) {
      final raw = await _storage.read(key: _closeoutSummaryKey(scope, eventId));
      if (raw != null) {
        final draft = jsonDecode(raw) as Map<String, dynamic>;
        data['offlineSummaryDraft'] = draft;
      }
    }
    return data;
  }

  Future<void> openEventCloseout(String eventId) async => _command<void>(
      {'action': 'event.closeout.open', 'eventId': eventId},
      (token, key) => _dio.post<void>('/api/v1/events/$eventId/closeout',
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key
          })));
  Future<void> updateCloseoutFollowup(
          String eventId, Map<String, Object?> input) async =>
      _command<void>(
          {'action': 'event.closeout.followup', 'eventId': eventId, ...input},
          (token, key) => _dio.put<void>(
              '/api/v1/events/$eventId/closeout/followups',
              data: input,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> updateCloseoutSummary(String eventId, String summary) async =>
      _command<void>(
          {
            'action': 'event.closeout.summary',
            'eventId': eventId,
            'summary': summary
          },
          (token, key) => _dio.put<void>(
              '/api/v1/events/$eventId/closeout/summary',
              data: {'summary': summary},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> finalizeEventCloseout(String eventId) async => _command<void>(
      {'action': 'event.closeout.finalize', 'eventId': eventId},
      (token, key) => _dio.post<void>(
          '/api/v1/events/$eventId/closeout/finalize',
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key
          })));
  Future<void> recordPostCloseCorrection(
          String eventId, Map<String, Object?> input) async =>
      _command<void>(
          {'action': 'event.closeout.correction', 'eventId': eventId, ...input},
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/closeout/corrections',
              data: input,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<bool> saveCloseoutSummary(String eventId, String summary) async {
    try {
      await updateCloseoutSummary(eventId, summary);
      final scope = await _auth.offlineCacheScope();
      if (scope != null) {
        await _storage.delete(key: _closeoutSummaryKey(scope, eventId));
      }
      return false;
    } on DioException catch (error) {
      if (error.response != null) rethrow;
      final scope = await _auth.offlineCacheScope();
      if (scope == null) rethrow;
      await _storage.write(
        key: _closeoutSummaryKey(scope, eventId),
        value: jsonEncode({
          'eventId': eventId,
          'summary': summary,
          'recordedAt': DateTime.now().toUtc().toIso8601String(),
          'state': 'pending',
        }),
      );
      return true;
    }
  }

  String _closeoutSummaryKey(String scope, String eventId) =>
      'venue.closeout.summary.outbox.$scope.$eventId';

  Future<void> synchronizeOfflineCloseoutSummaries() async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return;
    final prefix = 'venue.closeout.summary.outbox.$scope.';
    final rows = await _storage.readAll();
    final pending = rows.entries
        .where((row) => row.key.startsWith(prefix))
        .toList(growable: false);
    for (final entry in pending) {
      final draft = jsonDecode(entry.value) as Map<String, dynamic>;
      if (draft['state'] == 'needs_review') continue;
      final eventId = draft['eventId'] as String;
      try {
        await updateCloseoutSummary(eventId, draft['summary'] as String);
        await _storage.delete(key: entry.key);
      } on DioException catch (error) {
        if (error.response == null) return;
        await _storage.write(
          key: entry.key,
          value: jsonEncode({
            ...draft,
            'state': 'needs_review',
            'message':
                'The server did not accept this offline note. Review it against the current event closeout.'
          }),
        );
      }
    }
  }

  Future<List<dynamic>> shifts(String eventId) => _cachedGet(
      'shifts.$eventId',
      () async =>
          (await _request((token) => _dio.get<List<dynamic>>(
                  '/api/v1/events/$eventId/shifts',
                  options:
                      Options(headers: {'Authorization': 'Bearer $token'}))))
              .data ??
          const []);
  Future<List<dynamic>> coverageRequirements(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/coverage/requirements',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<List<dynamic>> coverageForecast(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/coverage/forecast',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<List<dynamic>> vendorStaffingRequests(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/vendor-staffing',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<void> createVendorStaffingRequest(
          String eventId, Map<String, Object?> data) async =>
      _command<void>(
          {'action': 'vendor-staffing.create', 'eventId': eventId, ...data},
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/vendor-staffing',
              data: data,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> vendorStaffingAction(String eventId, String requestId,
          String action, Map<String, Object?> data) async =>
      _command<void>(
          {
            'action': 'vendor-staffing.$action',
            'eventId': eventId,
            'requestId': requestId,
            ...data
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/vendor-staffing/$requestId/$action',
              data: data,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> createCoverageRequirement(
          String eventId, Map<String, Object?> demand) async =>
      _command<void>(
          {'eventId': eventId, ...demand},
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/coverage/requirements',
              data: demand,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> updateCoverageRequirement(
          String eventId, String demandId, Map<String, Object?> patch) async =>
      _command<void>(
          {'eventId': eventId, 'demandId': demandId, ...patch},
          (token, key) => _dio.put<void>(
              '/api/v1/events/$eventId/coverage/requirements/$demandId',
              data: patch,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<Map<String, dynamic>> generateCoverageShifts(
      String eventId, String demandId) async {
    final response = await _command<Response<Map<String, dynamic>>>(
      {'eventId': eventId, 'demandId': demandId},
      (token, key) => _dio.post<Map<String, dynamic>>(
        '/api/v1/events/$eventId/coverage/requirements/$demandId/generate',
        options: Options(headers: {
          'Authorization': 'Bearer $token',
          'Idempotency-Key': key
        }),
      ),
    );
    return response.data ?? const {};
  }

  Future<List<dynamic>> teamAvailability(
          String eventId, DateTime from, DateTime to) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/availability',
              queryParameters: {
                'from': from.toUtc().toIso8601String(),
                'to': to.toUtc().toIso8601String(),
              },
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<List<dynamic>> myUnavailability() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/me/unavailability',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<void> createUnavailability(DateTime startsAt, DateTime endsAt) async =>
      _command<void>(
          {
            'action': 'staff-unavailability.create',
            'startsAt': startsAt.toUtc().toIso8601String(),
            'endsAt': endsAt.toUtc().toIso8601String()
          },
          (token, key) => _dio.post<void>('/api/v1/me/unavailability',
              data: {
                'startsAt': startsAt.toUtc().toIso8601String(),
                'endsAt': endsAt.toUtc().toIso8601String()
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> deleteUnavailability(String id) async => _command<void>(
      {'action': 'staff-unavailability.delete', 'id': id},
      (token, key) => _dio.delete<void>('/api/v1/me/unavailability/$id',
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key
          })));
  Future<List<dynamic>> evidence(String eventId, String issueId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/issues/$issueId/evidence',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<List<dynamic>> notifications() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/me/notifications',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<void> markNotificationRead(String notificationId) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    await _dio.post<void>('/api/v1/me/notifications/$notificationId/read',
        options: Options(headers: {'Authorization': 'Bearer $token'}));
  }

  Future<void> registerPushDevice({
    required String installationId,
    required String platform,
    required String registrationToken,
  }) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    await _dio.post<void>('/api/v1/me/push-devices',
        data: {
          'installationId': installationId,
          'platform': platform,
          'registrationToken': registrationToken,
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}));
  }

  Future<void> revokePushDevice(String installationId) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    await _dio.delete<void>('/api/v1/me/push-devices/$installationId',
        options: Options(headers: {'Authorization': 'Bearer $token'}));
  }

  Future<void> issueAction(String eventId, String issueId, String action,
      {String? reason, String? ownerId}) async {
    await _command<void>(
      {
        'action': 'issue.$action',
        'eventId': eventId,
        'issueId': issueId,
        'reason': reason,
        'ownerId': ownerId,
      },
      (token, key) => _dio.post<void>(
        '/api/v1/events/$eventId/issues/$issueId/$action',
        data: action == 'assign'
            ? {'ownerId': ownerId, 'reason': reason}
            : {'reason': reason},
        options: Options(headers: {
          'Authorization': 'Bearer $token',
          'Idempotency-Key': key,
        }),
      ),
    );
  }

  Future<void> updateTask(
          String eventId, String taskId, Map<String, Object?> patch) async =>
      _command<void>(
          {
            'action': 'task.update',
            'eventId': eventId,
            'taskId': taskId,
            'patch': patch
          },
          (token, key) =>
              _dio.put<void>('/api/v1/events/$eventId/tasks/$taskId',
                  data: patch,
                  options: Options(headers: {
                    'Authorization': 'Bearer $token',
                    'Idempotency-Key': key,
                  })));
  Future<void> createTask(String eventId, Map<String, Object?> task) async =>
      _command<void>(
          {'action': 'task.create', 'eventId': eventId, 'task': task},
          (token, key) => _dio.post<void>('/api/v1/events/$eventId/tasks',
              data: task,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> createShift(String eventId, Map<String, Object?> shift) async =>
      _command<void>(
          {'action': 'staff-shift.create', 'eventId': eventId, 'shift': shift},
          (token, key) => _dio.post<void>('/api/v1/events/$eventId/shifts',
              data: shift,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> updateShift(
          String eventId, String shiftId, Map<String, Object?> patch) async =>
      _command<void>(
          {
            'action': 'staff-shift.update',
            'eventId': eventId,
            'shiftId': shiftId,
            'patch': patch
          },
          (token, key) =>
              _dio.put<void>('/api/v1/events/$eventId/shifts/$shiftId',
                  data: patch,
                  options: Options(headers: {
                    'Authorization': 'Bearer $token',
                    'Idempotency-Key': key,
                  })));
  Future<List<Map<String, dynamic>>> scheduleViews(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/events/$eventId/schedule-views',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> createScheduleView(String eventId, String name, bool shared,
          Map<String, Object?> filters) async =>
      _command<void>(
          {
            'action': 'schedule-view.create',
            'eventId': eventId,
            'name': name,
            'shared': shared,
            'filters': filters
          },
          (token, key) => _dio.post<void>(
                '/api/v1/events/$eventId/schedule-views',
                data: {'name': name, 'shared': shared, 'filters': filters},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<void> deleteScheduleView(String eventId, String viewId) async =>
      _command<void>(
          {
            'action': 'schedule-view.delete',
            'eventId': eventId,
            'viewId': viewId
          },
          (token, key) => _dio.delete<void>(
                '/api/v1/events/$eventId/schedule-views/$viewId',
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<List<Map<String, dynamic>>> previewBulkShifts(
          String eventId, Map<String, Object?> input) async =>
      (await _request((token) => _dio.post<List<dynamic>>(
                '/api/v1/events/$eventId/shifts/bulk/preview',
                data: input,
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<Map<String, dynamic>> bulkShifts(
          String eventId, Map<String, Object?> input) async =>
      _command<Map<String, dynamic>>(
          {'action': 'staff-shift.bulk', 'eventId': eventId, 'input': input},
          (token, key) async => (await _dio.post<Map<String, dynamic>>(
                '/api/v1/events/$eventId/shifts/bulk',
                data: input,
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ))
                  .data!);
  Future<List<Map<String, dynamic>>> inventoryCounts(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/events/$eventId/inventory/counts',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
  Future<void> startInventoryCount(String eventId, String venueId,
          {String? locationId}) async =>
      _command<void>(
          {
            'action': 'stock-count.start',
            'eventId': eventId,
            'venueId': venueId,
            'locationId': locationId
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/counts',
              data: {
                'venueId': venueId,
                if (locationId != null) 'locationId': locationId
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> createInventoryItem(
          String venueId, String sku, String name, String unit,
          {String? locationId}) async =>
      _command<void>(
          {
            'action': 'stock-item.create',
            'venueId': venueId,
            'sku': sku,
            'name': name,
            'unit': unit,
            'locationId': locationId
          },
          (token, key) => _dio.post<void>('/api/v1/admin/inventory/items',
              data: {
                'venueId': venueId,
                'sku': sku,
                'name': name,
                'unit': unit,
                if (locationId != null) 'locationId': locationId
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> recordInventoryCount(
          String eventId, String countId, String lineId, double quantity,
          {String? note}) async =>
      _command<void>(
          {
            'action': 'stock-count.record',
            'eventId': eventId,
            'countId': countId,
            'lineId': lineId,
            'quantity': quantity,
            'note': note
          },
          (token, key) => _dio.put<void>(
              '/api/v1/events/$eventId/inventory/counts/$countId/lines/$lineId',
              data: {'quantity': quantity, if (note != null) 'note': note},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> inventoryCountCommand(
          String eventId, String countId, String action,
          {String? reason}) async =>
      _command<void>(
          {
            'action': 'stock-count.$action',
            'eventId': eventId,
            'countId': countId,
            'reason': reason
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/counts/$countId/$action',
              data: action == 'approve' ? {'reason': reason} : null,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<List<Map<String, dynamic>>> inventoryItems(String venueId,
          {String? locationId}) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/inventory/items',
                queryParameters: {
                  'venueId': venueId,
                  if (locationId != null) 'locationId': locationId
                },
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
  Future<List<Map<String, dynamic>>> stockTransfers(String eventId) async =>
      (await _cachedGet(
          'stock-transfers.$eventId',
          () async => (await _request((token) => _dio.get<List<dynamic>>(
                    '/api/v1/events/$eventId/inventory/transfers',
                    options:
                        Options(headers: {'Authorization': 'Bearer $token'}),
                  )))
              .data!
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList()));
  Future<List<Map<String, dynamic>>> stockPurchaseOrders(
          String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/events/$eventId/inventory/purchase-orders',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
  Future<void> createStockPurchaseOrder(
          String eventId,
          String venueId,
          String? locationId,
          String supplierName,
          String? supplierReference,
          String? note,
          List<Map<String, Object?>> lines) async =>
      _command<void>(
          {
            'action': 'stock-purchase-order.create',
            'eventId': eventId,
            'venueId': venueId,
            'locationId': locationId,
            'supplierName': supplierName,
            'supplierReference': supplierReference,
            'note': note,
            'lines': lines
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/purchase-orders',
              data: {
                'venueId': venueId,
                if (locationId != null) 'locationId': locationId,
                'supplierName': supplierName,
                if (supplierReference != null)
                  'supplierReference': supplierReference,
                if (note != null) 'note': note,
                'lines': lines
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> stockPurchaseOrderAction(
          String eventId, String orderId, String action,
          {List<Map<String, Object?>>? lines,
          String? note,
          String? reason}) async =>
      _command<void>(
          {
            'action': 'stock-purchase-order.$action',
            'eventId': eventId,
            'orderId': orderId,
            'lines': lines,
            'note': note,
            'reason': reason
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/purchase-orders/$orderId/$action',
              data: {
                if (lines != null) 'lines': lines,
                if (note != null) 'note': note,
                if (reason != null) 'reason': reason
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> createStockTransfer(
          String eventId,
          String venueId,
          String? sourceLocationId,
          String? destinationLocationId,
          List<Map<String, Object?>> lines) async =>
      _command<void>(
          {
            'action': 'stock-transfer.create',
            'eventId': eventId,
            'venueId': venueId,
            'sourceLocationId': sourceLocationId,
            'destinationLocationId': destinationLocationId,
            'lines': lines
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/transfers',
              data: {
                'venueId': venueId,
                if (sourceLocationId != null)
                  'sourceLocationId': sourceLocationId,
                if (destinationLocationId != null)
                  'destinationLocationId': destinationLocationId,
                'lines': lines
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> stockTransferAction(
          String eventId, String transferId, String action,
          {Map<String, Object?>? data}) async =>
      _command<void>(
          {
            'action': 'stock-transfer.$action',
            'eventId': eventId,
            'transferId': transferId,
            'data': data
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/inventory/transfers/$transferId/$action',
              data: data,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<List<Map<String, dynamic>>> hospitalityOrders(String eventId) async =>
      (await _cachedGet(
          'hospitality.$eventId',
          () async => (await _request((token) => _dio.get<List<dynamic>>(
                    '/api/v1/events/$eventId/hospitality/orders',
                    options:
                        Options(headers: {'Authorization': 'Bearer $token'}),
                  )))
              .data!
              .map((row) => Map<String, dynamic>.from(row as Map))
              .toList()));
  Future<List<Map<String, dynamic>>> hospitalityMenuItems(
          String venueId) async =>
      (await _cachedGet(
          'hospitality.menu.$venueId',
          () async => (await _request((token) => _dio.get<List<dynamic>>(
                    '/api/v1/venues/$venueId/hospitality/menu-items',
                    options:
                        Options(headers: {'Authorization': 'Bearer $token'}),
                  )))
              .data!
              .map((row) => Map<String, dynamic>.from(row as Map))
              .toList()));
  Future<void> createHospitalityMenuItem(
          String venueId, Map<String, Object?> data) async =>
      _command<void>(
          {
            'action': 'hospitality.menu_item.create',
            'venueId': venueId,
            'data': data
          },
          (token, key) => _dio.post<void>(
                '/api/v1/admin/venues/$venueId/hospitality/menu-items',
                data: data,
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                }),
              ));
  Future<List<Map<String, dynamic>>> adminHospitalityMenuItems(
          String venueId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/admin/venues/$venueId/hospitality/menu-items',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
  Future<void> setHospitalityMenuItemActive(
          String venueId, String itemId, bool active) async =>
      _command<void>(
          {
            'action': 'hospitality.menu_item.status',
            'venueId': venueId,
            'itemId': itemId,
            'active': active
          },
          (token, key) => _dio.put<void>(
                '/api/v1/admin/venues/$venueId/hospitality/menu-items/$itemId',
                data: {'active': active},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                }),
              ));
  Future<Map<String, dynamic>> hospitalityPolicy() async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/hospitality-policy',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
  Future<void> updateHospitalityPolicy({
    required double? threshold,
    required String currencyCode,
  }) async =>
      _command<void>(
          {
            'action': 'hospitality.policy.update',
            'threshold': threshold,
            'currencyCode': currencyCode
          },
          (token, key) => _dio.put<void>(
                '/api/v1/admin/hospitality-policy',
                data: {
                  'hospitalityApprovalThreshold': threshold,
                  'hospitalityCurrencyCode': currencyCode,
                },
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                }),
              ));
  Future<List<Map<String, dynamic>>> hospitalityDrafts(String eventId) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return const [];
    final raw = await _storage.read(key: 'venue.hospitality.drafts.$scope');
    if (raw == null) return const [];
    return (jsonDecode(raw) as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) => row['eventId'] == eventId)
        .toList();
  }

  Future<void> saveHospitalityDraft(
      String eventId, Map<String, Object?> draft) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) {
      throw StateError('Sign in again to save a scoped offline draft.');
    }
    final key = 'venue.hospitality.drafts.$scope';
    final rows = await _storage.read(key: key);
    final drafts = rows == null
        ? <Map<String, dynamic>>[]
        : (jsonDecode(rows) as List)
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
    drafts.add({
      'draftId': const Uuid().v4(),
      'eventId': eventId,
      'savedAt': DateTime.now().toUtc().toIso8601String(),
      ...draft
    });
    await _storage.write(key: key, value: jsonEncode(drafts));
  }

  Future<void> deleteHospitalityDraft(String eventId, String draftId) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return;
    final key = 'venue.hospitality.drafts.$scope';
    final raw = await _storage.read(key: key);
    if (raw == null) return;
    final drafts = (jsonDecode(raw) as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) => row['eventId'] != eventId || row['draftId'] != draftId)
        .toList();
    if (drafts.isEmpty) {
      await _storage.delete(key: key);
    } else {
      await _storage.write(key: key, value: jsonEncode(drafts));
    }
  }

  Future<void> submitHospitalityDraft(
      String eventId, Map<String, dynamic> draft) async {
    final data = Map<String, Object?>.from(draft)
      ..remove('draftId')
      ..remove('eventId')
      ..remove('savedAt');
    await createHospitalityOrder(eventId, data);
    await deleteHospitalityDraft(eventId, draft['draftId'] as String);
  }

  Future<List<Map<String, dynamic>>> pendingHospitalityHandoffs(
      String eventId) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return const [];
    final raw = await _storage.read(key: 'venue.hospitality.handoffs.$scope');
    if (raw == null) return const [];
    return (jsonDecode(raw) as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) => row['eventId'] == eventId)
        .toList();
  }

  Future<void> savePendingHospitalityHandoff(
      String eventId, String orderId, Map<String, Object?> receipt) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) {
      throw StateError('Sign in again to save this handoff securely.');
    }
    final storageKey = 'venue.hospitality.handoffs.$scope';
    final raw = await _storage.read(key: storageKey);
    final handoffs = raw == null
        ? <Map<String, dynamic>>[]
        : (jsonDecode(raw) as List)
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
    if (handoffs
        .any((row) => row['eventId'] == eventId && row['orderId'] == orderId)) {
      throw StateError(
          'A handoff for this order is already pending. Sync the saved receipt before capturing another.');
    }
    handoffs.add({
      'handoffId': const Uuid().v4(),
      'idempotencyKey': const Uuid().v4(),
      'eventId': eventId,
      'orderId': orderId,
      'savedAt': DateTime.now().toUtc().toIso8601String(),
      'receipt': receipt,
    });
    await _storage.write(key: storageKey, value: jsonEncode(handoffs));
  }

  Future<void> saveHospitalityHandoffPhotoEvidenceId(
      String eventId, String handoffId, String evidenceId) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) {
      throw StateError('Sign in again to continue syncing this handoff.');
    }
    final storageKey = 'venue.hospitality.handoffs.$scope';
    final raw = await _storage.read(key: storageKey);
    if (raw == null) {
      throw StateError('The pending handoff could not be found.');
    }
    final handoffs = (jsonDecode(raw) as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
    final index = handoffs.indexWhere(
        (row) => row['eventId'] == eventId && row['handoffId'] == handoffId);
    if (index < 0) {
      throw StateError('The pending handoff could not be found.');
    }
    handoffs[index]['photoEvidenceId'] = evidenceId;
    await _storage.write(key: storageKey, value: jsonEncode(handoffs));
  }

  Future<void> deletePendingHospitalityHandoff(
      String eventId, String handoffId) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return;
    final storageKey = 'venue.hospitality.handoffs.$scope';
    final raw = await _storage.read(key: storageKey);
    if (raw == null) return;
    final handoffs = (jsonDecode(raw) as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .where(
            (row) => row['eventId'] != eventId || row['handoffId'] != handoffId)
        .toList();
    if (handoffs.isEmpty) {
      await _storage.delete(key: storageKey);
    } else {
      await _storage.write(key: storageKey, value: jsonEncode(handoffs));
    }
  }

  Future<void> createHospitalityOrder(
          String eventId, Map<String, Object?> order) async =>
      _command<void>(
          {'action': 'hospitality.order.create', 'eventId': eventId, ...order},
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/hospitality/orders',
              data: order,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> hospitalityOrderAction(
          String eventId, String orderId, String action,
          {String? reason,
          List<Map<String, Object?>>? fulfillments,
          String? receivedByName,
          String? receiptNote,
          bool? receiverAcknowledged,
          String? receiverSignature,
          String? receiverPhotoEvidenceId,
          String? idempotencyKeyOverride}) async =>
      _command<void>(
          {
            'action': 'hospitality.order.$action',
            'eventId': eventId,
            'orderId': orderId,
            'reason': reason,
            'fulfillments': fulfillments,
            'receivedByName': receivedByName,
            'receiptNote': receiptNote,
            'receiverAcknowledged': receiverAcknowledged,
            'receiverSignature': receiverSignature,
            'receiverPhotoEvidenceId': receiverPhotoEvidenceId
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/hospitality/orders/$orderId/actions',
              data: {
                'action': action,
                if (reason != null) 'reason': reason,
                if (fulfillments != null) 'fulfillments': fulfillments,
                if (receivedByName != null) 'receivedByName': receivedByName,
                if (receiptNote != null) 'receiptNote': receiptNote,
                if (receiverAcknowledged != null)
                  'receiverAcknowledged': receiverAcknowledged,
                if (receiverSignature != null)
                  'receiverSignature': receiverSignature,
                if (receiverPhotoEvidenceId != null)
                  'receiverPhotoEvidenceId': receiverPhotoEvidenceId
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })),
          idempotencyKeyOverride: idempotencyKeyOverride);
  Future<String> uploadHospitalityReceiptPhoto(String eventId, String orderId,
      LocalIssueEvidence evidence, List<int> cleartext) async {
    final response = await _request((token) => _dio.post<Map<String, dynamic>>(
          '/api/v1/events/$eventId/hospitality/orders/$orderId/receipt-evidence',
          data: {
            'clientId': evidence.clientId,
            'fileName': evidence.fileName,
            'contentType': evidence.contentType,
            'sizeBytes': evidence.sizeBytes,
            'sha256': evidence.sha256,
          },
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
    final body = response.data!;
    final uploadUrl = body['uploadUrl'] as String?;
    if (uploadUrl != null) {
      final fields = Map<String, dynamic>.from(body['uploadFields'] as Map);
      final form = FormData.fromMap({
        ...fields,
        'file': MultipartFile.fromBytes(Uint8List.fromList(cleartext),
            filename: evidence.fileName,
            contentType: DioMediaType.parse(evidence.contentType)),
      });
      await Dio().post<void>(uploadUrl,
          data: form, options: Options(contentType: 'multipart/form-data'));
    }
    final evidenceId = (body['evidence'] as Map)['id'] as String;
    await _request((token) => _dio.post<Map<String, dynamic>>(
          '/api/v1/events/$eventId/hospitality/orders/$orderId/receipt-evidence/$evidenceId/complete',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        ));
    return evidenceId;
  }

  Future<String> hospitalityReceiptPhotoUrl(
          String eventId, String orderId, String evidenceId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
              '/api/v1/events/$eventId/hospitality/orders/$orderId/receipt-evidence/$evidenceId/download',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data!['downloadUrl'] as String;
  Future<Map<String, dynamic>> shiftAssignmentSuggestions(
          String eventId, String shiftId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/events/$eventId/shifts/$shiftId/assignment-suggestions',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
  Future<List<dynamic>> availabilityChecksForShift(
          String eventId, String shiftId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/shifts/$shiftId/availability-checks',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<void> requestShiftAvailability(
          String eventId, String shiftId, List<String> subjects) async =>
      _command<void>(
          {
            'action': 'staff-availability-check.request',
            'eventId': eventId,
            'shiftId': shiftId,
            'subjects': subjects
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/shifts/$shiftId/availability-checks',
              data: {'subjects': subjects},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<List<dynamic>> myAvailabilityChecks() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/me/availability-checks',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];
  Future<void> respondToAvailabilityCheck(
          String checkId, String response) async =>
      _command<void>(
          {'action': 'staff-availability-check.$response', 'checkId': checkId},
          (token, key) => _dio.post<void>(
              '/api/v1/me/availability-checks/$checkId/respond',
              data: {'response': response},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> shiftCommand(String eventId, String shiftId, String action,
      {Map<String, Object?>? data}) async {
    await _command<void>(
        {
          'action': 'staff-shift.$action',
          'eventId': eventId,
          'shiftId': shiftId
        },
        (token, key) =>
            _dio.post<void>('/api/v1/events/$eventId/shifts/$shiftId/$action',
                data: data,
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                })));
  }

  Future<List<Map<String, dynamic>>> queuedOfflineAttendance() async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return const [];
    final prefix = 'venue.staff.attendance.$scope.';
    final rows = await _storage.readAll();
    return rows.entries
        .where((row) => row.key.startsWith(prefix))
        .map((row) => jsonDecode(row.value) as Map<String, dynamic>)
        .toList()
      ..sort((a, b) => DateTime.parse(a['recordedAt'] as String)
          .compareTo(DateTime.parse(b['recordedAt'] as String)));
  }

  Future<void> enqueueOfflineAttendance(
      String eventId, String shiftId, String action) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) {
      throw StateError('Sign in again before recording attendance offline.');
    }
    if (action != 'CHECK_IN' && action != 'CHECK_OUT') {
      throw ArgumentError.value(action, 'action');
    }
    final id = const Uuid().v4();
    final item = <String, Object?>{
      'id': id,
      'eventId': eventId,
      'shiftId': shiftId,
      'action': action,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
      'sessionScope': scope,
    };
    await _storage.write(
        key: 'venue.staff.attendance.$scope.$id', value: jsonEncode(item));
  }

  Future<void> synchronizeOfflineAttendance() async {
    final scope = await _auth.offlineCacheScope();
    final token = await _auth.validAccessToken();
    if (scope == null || token == null || token.isEmpty) return;
    final prefix = 'venue.staff.attendance.$scope.';
    final rows = await _storage.readAll();
    final pending = rows.entries
        .where((entry) => entry.key.startsWith(prefix))
        .map((entry) => MapEntry(
            entry.key, jsonDecode(entry.value) as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => DateTime.parse(a.value['recordedAt'] as String)
          .compareTo(DateTime.parse(b.value['recordedAt'] as String)));
    for (final row in pending) {
      final item = row.value;
      if (item['sessionScope'] != scope) continue;
      try {
        await _dio.post<void>(
            '/api/v1/events/${item['eventId']}/shifts/${item['shiftId']}/attendance/offline',
            data: {'action': item['action'], 'recordedAt': item['recordedAt']},
            options: Options(headers: {
              'Authorization': 'Bearer $token',
              'Idempotency-Key': item['id']
            }));
        await _storage.delete(key: row.key);
      } catch (error) {
        if (error is DioException &&
            error.response != null &&
            error.response!.statusCode != 409) {
          rethrow;
        }
      }
    }
  }

  Future<List<dynamic>> reviewOfflineAttendance(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/attendance/offline',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ??
      const [];

  Future<void> decideOfflineAttendance(String eventId, String claimId,
          String decision, String reason) async =>
      _command<void>(
          {
            'eventId': eventId,
            'claimId': claimId,
            'decision': decision,
            'reason': reason.trim()
          },
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/attendance/offline/$claimId/review',
              data: {'decision': decision, 'reason': reason.trim()},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));

  Future<void> correctAttendance(String eventId, String shiftId,
          Map<String, Object?> correction) async =>
      _command<void>(
          {'eventId': eventId, 'shiftId': shiftId, ...correction},
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/shifts/$shiftId/attendance/correction',
              data: correction,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> respondToShift(String eventId, String shiftId, String response,
      {String? reason}) async {
    await _command<void>(
        {
          'action': 'staff-shift.response',
          'eventId': eventId,
          'shiftId': shiftId,
          'response': response,
          'reason': reason,
        },
        (token, key) => _dio.post<void>(
            '/api/v1/events/$eventId/shifts/$shiftId/response',
            data: {'response': response, if (reason != null) 'reason': reason},
            options: Options(headers: {
              'Authorization': 'Bearer $token',
              'Idempotency-Key': key,
            })));
  }

  Future<void> updateOrganizationName(String name) async => _command<void>(
      {'action': 'organization.update', 'name': name.trim()},
      (token, key) => _dio.put<void>('/api/v1/admin/organization',
          data: {'name': name.trim()},
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key,
          })));

  Future<void> createVenue(String name, String timeZone) async =>
      _command<void>(
          {
            'action': 'venue.create',
            'name': name.trim(),
            'timeZone': timeZone.trim()
          },
          (token, key) => _dio.post<void>('/api/v1/admin/venues',
              data: {'name': name.trim(), 'timeZone': timeZone.trim()},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> updateVenue(
          String venueId, String name, String timeZone) async =>
      _command<void>(
          {
            'action': 'venue.update',
            'venueId': venueId,
            'name': name.trim(),
            'timeZone': timeZone.trim()
          },
          (token, key) => _dio.put<void>('/api/v1/admin/venues/$venueId',
              data: {'name': name.trim(), 'timeZone': timeZone.trim()},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<Map<String, dynamic>> venueReadiness(String venueId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/venues/$venueId/readiness',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
  Future<Map<String, dynamic>> venueStructure(String venueId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/venues/$venueId/structure',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
  Future<Map<String, dynamic>> venueOnboarding(String venueId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/venues/$venueId/onboarding',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<Map<String, dynamic>> previewVenueEvent(
          String venueId, String startsAtLocal) async =>
      (await _request((token) => _dio.post<Map<String, dynamic>>(
                '/api/v1/admin/venues/$venueId/event-preview',
                data: {'startsAtLocal': startsAtLocal},
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<void> createVenueDepartment(
          String venueId, String code, String name) async =>
      _command<void>(
          {
            'action': 'venue-department.create',
            'venueId': venueId,
            'code': code,
            'name': name
          },
          (token, key) => _dio.post<void>(
                '/api/v1/admin/venues/$venueId/departments',
                data: {'code': code, 'name': name},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<void> createVenueServiceArea(String venueId, String code, String name,
          String? departmentId) async =>
      _command<void>(
          {
            'action': 'venue-service-area.create',
            'venueId': venueId,
            'code': code,
            'name': name,
            'departmentId': departmentId
          },
          (token, key) => _dio.post<void>(
                '/api/v1/admin/venues/$venueId/service-areas',
                data: {
                  'code': code,
                  'name': name,
                  if (departmentId != null) 'departmentId': departmentId
                },
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<void> setLocationServiceArea(
          String locationId, String? serviceAreaId) async =>
      _command<void>(
          {
            'action': 'location.service-area.set',
            'locationId': locationId,
            'serviceAreaId': serviceAreaId
          },
          (token, key) => _dio.put<void>(
                '/api/v1/admin/locations/$locationId/service-area',
                data: {'serviceAreaId': serviceAreaId},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));
  Future<List<Map<String, dynamic>>> venueTemplates() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/admin/venue-templates',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

  Future<void> captureVenueTemplate(String sourceVenueId, String code,
          String name, String? defaultEventStartLocal) async =>
      _command<void>(
          {
            'action': 'venue-template.capture',
            'sourceVenueId': sourceVenueId,
            'code': code,
            'name': name,
            'defaultEventStartLocal': defaultEventStartLocal
          },
          (token, key) => _dio.post<void>(
                '/api/v1/admin/venue-templates',
                data: {
                  'sourceVenueId': sourceVenueId,
                  'code': code,
                  'name': name,
                  if (defaultEventStartLocal != null)
                    'defaultEventStartLocal': defaultEventStartLocal
                },
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<Map<String, dynamic>> previewVenueTemplate(
          String templateId, String venueId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/venue-templates/$templateId/preview/$venueId',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;

  Future<void> applyVenueTemplate(String templateId, String venueId) async =>
      _command<void>(
          {
            'action': 'venue-template.apply',
            'templateId': templateId,
            'venueId': venueId
          },
          (token, key) => _dio.post<void>(
                '/api/v1/admin/venue-templates/$templateId/apply/$venueId',
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key
                }),
              ));

  Future<void> updateVenueLifecycle(String venueId, String action) async =>
      _command<void>(
          {'action': 'venue.lifecycle.$action', 'venueId': venueId},
          (token, key) => _dio.put<void>(
                '/api/v1/admin/venues/$venueId/lifecycle',
                data: {'action': action},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                }),
              ));
  Future<void> createLocation(String venueId, String name) async => _command<
          void>(
      {'action': 'location.create', 'venueId': venueId, 'name': name.trim()},
      (token, key) => _dio.post<void>('/api/v1/admin/locations',
          data: {'venueId': venueId, 'name': name},
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key,
          })));
  Future<void> updateLocation(String locationId, String name) async =>
      _command<void>(
          {
            'action': 'location.update',
            'locationId': locationId,
            'name': name.trim()
          },
          (token, key) => _dio.put<void>('/api/v1/admin/locations/$locationId',
              data: {'name': name.trim()},
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<Map<String, dynamic>> hospitalityMenuRecipe(
          String venueId, String itemId) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/venues/$venueId/hospitality/menu-items/$itemId/recipe',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
  Future<List<Map<String, dynamic>>> recipeInventoryItems(
          String venueId) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
                '/api/v1/admin/venues/$venueId/inventory/items',
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
  Future<void> setHospitalityMenuRecipe(String venueId, String itemId,
          List<Map<String, Object?>> lines) async =>
      _command<void>(
          {
            'action': 'hospitality.menu_recipe.set',
            'venueId': venueId,
            'itemId': itemId,
            'lines': lines,
          },
          (token, key) => _dio.put<void>(
                '/api/v1/admin/venues/$venueId/hospitality/menu-items/$itemId/recipe',
                data: {'lines': lines},
                options: Options(headers: {
                  'Authorization': 'Bearer $token',
                  'Idempotency-Key': key,
                }),
              ));
  Future<void> createEvent(
          String venueId, String name, String startsAtLocal) async =>
      _command<void>(
          {
            'action': 'event.create',
            'venueId': venueId,
            'name': name.trim(),
            'startsAtLocal': startsAtLocal,
          },
          (token, key) => _dio.post<void>('/api/v1/admin/events',
              data: {
                'venueId': venueId,
                'name': name,
                'startsAtLocal': startsAtLocal,
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> updateEvent(String eventId,
          {String? name, String? startsAtLocal}) async =>
      _command<void>(
          {
            'action': 'event.update',
            'eventId': eventId,
            if (name != null) 'name': name.trim(),
            if (startsAtLocal != null) 'startsAtLocal': startsAtLocal,
          },
          (token, key) => _dio.put<void>('/api/v1/admin/events/$eventId',
              data: {
                if (name != null) 'name': name.trim(),
                if (startsAtLocal != null) 'startsAtLocal': startsAtLocal,
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> savePerson(
          String subject, String email, String displayName) async =>
      _command<void>(
          {
            'action': 'person.upsert',
            'subject': subject,
            'email': email.trim().toLowerCase(),
            'displayName': displayName.trim()
          },
          (token, key) => _dio.post<void>('/api/v1/admin/people',
              data: {
                'externalSubject': subject,
                'email': email,
                'displayName': displayName
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> setPersonActive(String personId, bool active) async =>
      _command<void>(
          {
            'action': 'person.${active ? 'activate' : 'deactivate'}',
            'personId': personId,
            'active': active
          },
          (token, key) =>
              _dio.put<void>('/api/v1/admin/people/$personId/status',
                  data: {'active': active},
                  options: Options(headers: {
                    'Authorization': 'Bearer $token',
                    'Idempotency-Key': key,
                  })));
  Future<void> grantQualification(String personId, String code, String name,
          {String? expiresAt}) async =>
      _command<void>(
          {
            'action': 'person-qualification.grant',
            'personId': personId,
            'code': code.trim().toUpperCase(),
            'name': name.trim(),
            'expiresAt': expiresAt
          },
          (token, key) => _dio.post<void>(
              '/api/v1/admin/people/$personId/qualifications',
              data: {
                'code': code,
                'name': name,
                if (expiresAt != null) 'expiresAt': expiresAt
              },
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<void> revokeQualification(String qualificationId) async =>
      _command<void>(
          {
            'action': 'person-qualification.revoke',
            'qualificationId': qualificationId
          },
          (token, key) => _dio.delete<void>(
              '/api/v1/admin/qualifications/$qualificationId',
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key
              })));
  Future<Map<String, dynamic>> uploadQualificationEvidence(
      String qualificationId,
      String fileName,
      String contentType,
      List<int> bytes) async {
    if (bytes.isEmpty || bytes.length > 10 * 1024 * 1024) {
      throw StateError('Credential evidence must be 10 MiB or smaller.');
    }
    final digest = await Sha256().hash(bytes);
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Sign in before uploading credential evidence.');
    }
    final headers = {'Authorization': 'Bearer $token'};
    final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/admin/qualifications/$qualificationId/evidence',
        data: {
          'fileName': fileName,
          'contentType': contentType,
          'sizeBytes': bytes.length,
          'sha256': digest.bytes
              .map((b) => b.toRadixString(16).padLeft(2, '0'))
              .join(),
        },
        options: Options(headers: headers));
    final upload = response.data;
    final uploadUrl = upload?['uploadUrl'];
    if (uploadUrl is! String || uploadUrl.isEmpty) {
      throw StateError('The evidence API did not return a private upload URL.');
    }
    final fields =
        Map<String, dynamic>.from(upload?['uploadFields'] as Map? ?? const {});
    await Dio().post<void>(uploadUrl,
        data: FormData.fromMap({
          ...fields,
          'file': MultipartFile.fromBytes(bytes,
              filename: fileName, contentType: DioMediaType.parse(contentType)),
        }));
    final completed = await _dio.post<Map<String, dynamic>>(
        '/api/v1/admin/qualifications/$qualificationId/evidence/complete',
        options: Options(headers: headers));
    return completed.data ?? const {};
  }

  Future<void> reviewQualificationEvidence(
      String qualificationId, String status, String reason) async {
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Sign in before reviewing credential evidence.');
    }
    await _dio.put<void>(
        '/api/v1/admin/qualifications/$qualificationId/evidence/review',
        data: {'status': status, 'reason': reason.trim()},
        options: Options(headers: {'Authorization': 'Bearer $token'}));
  }

  Future<String> qualificationEvidenceDownload(String qualificationId) async {
    final response = await _request((token) => _dio.get<Map<String, dynamic>>(
        '/api/v1/admin/qualifications/$qualificationId/evidence/download',
        options: Options(headers: {'Authorization': 'Bearer $token'})));
    final url = response.data?['downloadUrl'];
    if (url is! String || url.isEmpty) {
      throw StateError('The evidence API did not return a download link.');
    }
    return url;
  }

  Future<Map<String, dynamic>> staffingPolicy() async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
              '/api/v1/admin/staffing-policy',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data!;
  Future<void> updateMinimumRestMinutes(int minutes) async => _command<void>(
      {'action': 'staffing-policy.update', 'minimumRestMinutes': minutes},
      (token, key) => _dio.put<void>('/api/v1/admin/staffing-policy',
          data: {'minimumRestMinutes': minutes},
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key
          })));
  Future<Map<String, dynamic>> audit({int limit = 50, String? cursor}) async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
                '/api/v1/admin/audit',
                queryParameters: {
                  'limit': limit,
                  if (cursor != null) 'cursor': cursor,
                },
                options: Options(headers: {'Authorization': 'Bearer $token'}),
              )))
          .data!;
}

final operationsApiProvider = Provider((ref) => OperationsApi(
    ref.watch(authRepositoryProvider), const FlutterSecureStorage()));
final staffAttendanceOutboxProvider = StateNotifierProvider<
    StaffAttendanceOutboxController, List<Map<String, dynamic>>>((ref) {
  ref.watch(authSessionProvider.select((value) => value.session?.accessToken));
  final controller =
      StaffAttendanceOutboxController(ref.watch(operationsApiProvider));
  unawaited(controller.restore());
  controller.watchConnectivity();
  return controller;
});
final operationsBootstrapProvider = FutureProvider.autoDispose(
    (ref) => ref.watch(operationsApiProvider).bootstrap());
final eventIssuesProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).issues(id));
final issueEventStreamProvider = StreamProvider.autoDispose
    .family<Map<String, dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).issueEvents(id));
final eventTasksProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).tasks(id));
final eventIntegrationEventsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).integrationEvents(id));
final eventCloseoutProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).eventCloseout(id));
final closeoutNoteSyncProvider = Provider((ref) {
  final controller = CloseoutNoteSyncController(
    ref.watch(operationsApiProvider),
    () => ref.invalidate(eventCloseoutProvider),
  );
  controller.start();
  ref.onDispose(controller.dispose);
  return controller;
});
final eventInventoryCountsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).inventoryCounts(id));
final eventStockTransfersProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).stockTransfers(id));
final eventStockPurchaseOrdersProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).stockPurchaseOrders(id));
final eventHospitalityOrdersProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).hospitalityOrders(id));
final venueHospitalityMenuItemsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).hospitalityMenuItems(id));
final adminVenueHospitalityMenuItemsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, id) =>
        ref.watch(operationsApiProvider).adminHospitalityMenuItems(id));
final hospitalityRecipeProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, ({String venueId, String itemId})>(
        (ref, key) => ref
            .watch(operationsApiProvider)
            .hospitalityMenuRecipe(key.venueId, key.itemId));
final recipeInventoryItemsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, venueId) =>
        ref.watch(operationsApiProvider).recipeInventoryItems(venueId));
final eventHospitalityDraftsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>(
        (ref, id) => ref.watch(operationsApiProvider).hospitalityDrafts(id));
final eventHospitalityHandoffsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, id) =>
        ref.watch(operationsApiProvider).pendingHospitalityHandoffs(id));
final eventShiftsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).shifts(id));
final myAvailabilityChecksProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).myAvailabilityChecks());
final staffingCoverageProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).coverageRequirements(id));
final vendorStaffingRequestsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, id) =>
        ref.watch(operationsApiProvider).vendorStaffingRequests(id));
typedef TeamAvailabilityRequest = ({
  String eventId,
  DateTime from,
  DateTime to
});
final teamAvailabilityProvider = FutureProvider.autoDispose
    .family<List<dynamic>, TeamAvailabilityRequest>((ref, request) => ref
        .watch(operationsApiProvider)
        .teamAvailability(request.eventId, request.from, request.to));
final myUnavailabilityProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).myUnavailability());
final userNotificationsProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).notifications());

class StaffAttendanceOutboxController
    extends StateNotifier<List<Map<String, dynamic>>> {
  StaffAttendanceOutboxController(this._api) : super(const []);
  final OperationsApi _api;
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  Future<void>? _syncing;

  Future<void> restore() async {
    final pending = await _api.queuedOfflineAttendance();
    if (mounted) state = pending;
  }

  void watchConnectivity() {
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        unawaited(synchronize());
      }
    });
    unawaited(_connectivity.checkConnectivity().then((results) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        unawaited(synchronize());
      }
    }, onError: (Object _) {}));
  }

  Future<bool> record(String eventId, String shiftId, String action,
      {bool queueForReview = false}) async {
    final online = (await _connectivity.checkConnectivity())
        .any((result) => result != ConnectivityResult.none);
    if (online && !queueForReview) {
      await _api.shiftCommand(
          eventId, shiftId, action == 'CHECK_IN' ? 'check-in' : 'check-out');
      return false;
    }
    await _api.enqueueOfflineAttendance(eventId, shiftId, action);
    await restore();
    if (online) unawaited(synchronize());
    return true;
  }

  Future<void> synchronize() async {
    if (!mounted) return;
    final current = _syncing;
    if (current != null) return current;
    final operation = _synchronize();
    _syncing = operation;
    try {
      await operation;
    } finally {
      _syncing = null;
    }
  }

  Future<void> _synchronize() async {
    try {
      await _api.synchronizeOfflineAttendance();
    } catch (_) {
      // Preserve pending device evidence when the API is unreachable or rejects a stale claim.
    }
    await restore();
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }
}

class CloseoutNoteSyncController {
  CloseoutNoteSyncController(this._api, this._onSynced);
  final OperationsApi _api;
  final void Function() _onSynced;
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _syncing = false;

  void start() {
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        unawaited(synchronize());
      }
    });
    unawaited(_connectivity.checkConnectivity().then((results) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        unawaited(synchronize());
      }
    }, onError: (Object _) {}));
  }

  Future<void> synchronize() async {
    if (_syncing) return;
    _syncing = true;
    try {
      await _api.synchronizeOfflineCloseoutSummaries();
      _onSynced();
    } catch (_) {
      // Keep encrypted drafts on the device if transport or storage is unavailable.
    } finally {
      _syncing = false;
    }
  }

  void dispose() => unawaited(_subscription?.cancel());
}
