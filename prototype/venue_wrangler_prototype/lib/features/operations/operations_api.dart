import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';
import '../../auth/auth.dart';
import '../../config/api_configuration.dart';

class OperationsApi {
  OperationsApi(this._auth, this._storage, {Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: ApiConfiguration.baseUrl));
  final AuthRepository _auth;
  final FlutterSecureStorage _storage;
  final Dio _dio;

  static const _cachePrefix = 'venue.operations.cache.';
  static const _maxCacheBytes = 256 * 1024;
  static const _maxCacheAge = Duration(hours: 12);

  Future<T> _cachedGet<T>(String cacheKey, Future<T> Function() load) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) return load();
    final storageKey = '$_cachePrefix$scope.$cacheKey';
    try {
      final value = await load();
      final encoded = jsonEncode({
        'cachedAt': DateTime.now().toUtc().toIso8601String(),
        'value': value
      });
      if (utf8.encode(encoded).length <= _maxCacheBytes) {
        await _storage.write(key: storageKey, value: encoded);
      }
      return value;
    } catch (error) {
      if (error is! DioException || error.response != null) rethrow;
      final encoded = await _storage.read(key: storageKey);
      if (encoded != null) {
        final snapshot = jsonDecode(encoded) as Map<String, dynamic>;
        final cachedAt =
            DateTime.tryParse(snapshot['cachedAt'] as String? ?? '');
        final age = cachedAt == null
            ? null
            : DateTime.now().toUtc().difference(cachedAt);
        if (age != null && age >= Duration.zero && age <= _maxCacheAge) {
          return snapshot['value'] as T;
        }
      }
      rethrow;
    }
  }

  Future<Response<T>> _request<T>(
      Future<Response<T>> Function(String token) call) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    return call(token);
  }

  Future<T> _command<T>(Map<String, Object?> command,
      Future<T> Function(String token, String idempotencyKey) send) async {
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    final scope = await _auth.offlineCacheScope();
    final digest = await Sha256().hash(utf8.encode(jsonEncode(command)));
    final commandHash = digest.bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    final storageKey =
        scope == null ? null : 'venue.operations.command.$scope.$commandHash';
    String? idempotencyKey;
    if (storageKey != null) {
      try {
        idempotencyKey = await _storage.read(key: storageKey);
      } catch (_) {
        // Continue with an in-memory key if secure storage is unavailable.
      }
    }
    idempotencyKey ??= const Uuid().v4();
    if (storageKey != null) {
      try {
        await _storage.write(key: storageKey, value: idempotencyKey);
      } catch (_) {
        // The request remains usable; persistence improves retry safety.
      }
    }
    final result = await send(token, idempotencyKey);
    if (storageKey != null) {
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
        options: Options(headers: {'Authorization': 'Bearer $token'})))).data ?? const [];
  Future<void> createCoverageRequirement(String eventId, Map<String, Object?> demand) async =>
      _command<void>({'eventId': eventId, ...demand}, (token, key) => _dio.post<void>(
        '/api/v1/events/$eventId/coverage/requirements', data: demand,
        options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<void> updateCoverageRequirement(String eventId, String demandId, Map<String, Object?> patch) async =>
      _command<void>({'eventId': eventId, 'demandId': demandId, ...patch}, (token, key) => _dio.put<void>(
        '/api/v1/events/$eventId/coverage/requirements/$demandId', data: patch,
        options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<Map<String, dynamic>> generateCoverageShifts(String eventId, String demandId) async {
    final response = await _command<Response<Map<String, dynamic>>>(
      {'eventId': eventId, 'demandId': demandId},
      (token, key) => _dio.post<Map<String, dynamic>>(
        '/api/v1/events/$eventId/coverage/requirements/$demandId/generate',
        options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key}),
      ),
    );
    return response.data ?? const {};
  }
  Future<List<dynamic>> teamAvailability(String eventId, DateTime from, DateTime to) async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/events/$eventId/availability',
              queryParameters: {
                'from': from.toUtc().toIso8601String(),
                'to': to.toUtc().toIso8601String(),
              },
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ?? const [];
  Future<List<dynamic>> myUnavailability() async =>
      (await _request((token) => _dio.get<List<dynamic>>(
              '/api/v1/me/unavailability',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data ?? const [];
  Future<void> createUnavailability(DateTime startsAt, DateTime endsAt) async =>
      _command<void>(
          {'action': 'staff-unavailability.create', 'startsAt': startsAt.toUtc().toIso8601String(), 'endsAt': endsAt.toUtc().toIso8601String()},
          (token, key) => _dio.post<void>('/api/v1/me/unavailability',
              data: {'startsAt': startsAt.toUtc().toIso8601String(), 'endsAt': endsAt.toUtc().toIso8601String()},
              options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<void> deleteUnavailability(String id) async =>
      _command<void>(
          {'action': 'staff-unavailability.delete', 'id': id},
          (token, key) => _dio.delete<void>('/api/v1/me/unavailability/$id',
              options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
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
          (token, key) => _dio.post<void>(
              '/api/v1/events/$eventId/shifts',
              data: shift,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> updateShift(String eventId, String shiftId,
          Map<String, Object?> patch) async =>
      _command<void>(
          {
            'action': 'staff-shift.update',
            'eventId': eventId,
            'shiftId': shiftId,
            'patch': patch
          },
          (token, key) => _dio.put<void>(
              '/api/v1/events/$eventId/shifts/$shiftId',
              data: patch,
              options: Options(headers: {
                'Authorization': 'Bearer $token',
                'Idempotency-Key': key,
              })));
  Future<void> shiftCommand(
      String eventId, String shiftId, String action, {Map<String, Object?>? data}) async {
    await _command<void>(
        {'action': 'staff-shift.$action', 'eventId': eventId, 'shiftId': shiftId},
        (token, key) => _dio.post<void>(
            '/api/v1/events/$eventId/shifts/$shiftId/$action',
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
    return rows.entries.where((row) => row.key.startsWith(prefix)).map((row) => jsonDecode(row.value) as Map<String, dynamic>).toList()
      ..sort((a, b) => DateTime.parse(a['recordedAt'] as String).compareTo(DateTime.parse(b['recordedAt'] as String)));
  }

  Future<void> enqueueOfflineAttendance(String eventId, String shiftId, String action) async {
    final scope = await _auth.offlineCacheScope();
    if (scope == null) throw StateError('Sign in again before recording attendance offline.');
    if (action != 'CHECK_IN' && action != 'CHECK_OUT') throw ArgumentError.value(action, 'action');
    final id = const Uuid().v4();
    final item = <String, Object?>{
      'id': id, 'eventId': eventId, 'shiftId': shiftId, 'action': action,
      'recordedAt': DateTime.now().toUtc().toIso8601String(), 'sessionScope': scope,
    };
    await _storage.write(key: 'venue.staff.attendance.$scope.$id', value: jsonEncode(item));
  }

  Future<void> synchronizeOfflineAttendance() async {
    final scope = await _auth.offlineCacheScope();
    final token = await _auth.validAccessToken();
    if (scope == null || token == null || token.isEmpty) return;
    final prefix = 'venue.staff.attendance.$scope.';
    final rows = await _storage.readAll();
    final pending = rows.entries.where((entry) => entry.key.startsWith(prefix)).map((entry) => MapEntry(entry.key, jsonDecode(entry.value) as Map<String, dynamic>)).toList()
      ..sort((a, b) => DateTime.parse(a.value['recordedAt'] as String).compareTo(DateTime.parse(b.value['recordedAt'] as String)));
    for (final row in pending) {
      final item = row.value;
      if (item['sessionScope'] != scope) continue;
      try {
        await _dio.post<void>('/api/v1/events/${item['eventId']}/shifts/${item['shiftId']}/attendance/offline',
          data: {'action': item['action'], 'recordedAt': item['recordedAt']},
          options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': item['id']}));
        await _storage.delete(key: row.key);
      } catch (error) {
        if (error is DioException && error.response != null && error.response!.statusCode != 409) rethrow;
      }
    }
  }

  Future<List<dynamic>> reviewOfflineAttendance(String eventId) async =>
      (await _request((token) => _dio.get<List<dynamic>>('/api/v1/events/$eventId/attendance/offline', options: Options(headers: {'Authorization': 'Bearer $token'})))).data ?? const [];

  Future<void> decideOfflineAttendance(String eventId, String claimId, String decision, String reason) async =>
      _command<void>({'eventId': eventId, 'claimId': claimId, 'decision': decision, 'reason': reason.trim()},
        (token, key) => _dio.post<void>('/api/v1/events/$eventId/attendance/offline/$claimId/review',
          data: {'decision': decision, 'reason': reason.trim()}, options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));

  Future<void> correctAttendance(String eventId, String shiftId, Map<String, Object?> correction) async =>
      _command<void>({'eventId': eventId, 'shiftId': shiftId, ...correction},
        (token, key) => _dio.post<void>('/api/v1/events/$eventId/shifts/$shiftId/attendance/correction',
          data: correction, options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<void> respondToShift(
      String eventId, String shiftId, String response, {String? reason}) async {
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
  Future<void> createVenue(String name) async => _command<void>(
      {'action': 'venue.create', 'name': name.trim()},
      (token, key) => _dio.post<void>('/api/v1/admin/venues',
          data: {'name': name},
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key,
          })));
  Future<void> createLocation(String venueId, String name) async => _command<
          void>(
      {'action': 'location.create', 'venueId': venueId, 'name': name.trim()},
      (token, key) => _dio.post<void>('/api/v1/admin/locations',
          data: {'venueId': venueId, 'name': name},
          options: Options(headers: {
            'Authorization': 'Bearer $token',
            'Idempotency-Key': key,
          })));
  Future<void> createEvent(
          String venueId, String name, DateTime startsAt) async =>
      _command<void>(
          {
            'action': 'event.create',
            'venueId': venueId,
            'name': name.trim(),
            'startsAt': startsAt.toUtc().toIso8601String()
          },
          (token, key) => _dio.post<void>('/api/v1/admin/events',
              data: {
                'venueId': venueId,
                'name': name,
                'startsAt': startsAt.toUtc().toIso8601String()
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
  Future<void> grantQualification(String personId, String code, String name, {String? expiresAt}) async =>
      _command<void>(
          {'action': 'person-qualification.grant', 'personId': personId, 'code': code.trim().toUpperCase(), 'name': name.trim(), 'expiresAt': expiresAt},
          (token, key) => _dio.post<void>('/api/v1/admin/people/$personId/qualifications',
              data: {'code': code, 'name': name, if (expiresAt != null) 'expiresAt': expiresAt},
              options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<void> revokeQualification(String qualificationId) async =>
      _command<void>(
          {'action': 'person-qualification.revoke', 'qualificationId': qualificationId},
          (token, key) => _dio.delete<void>('/api/v1/admin/qualifications/$qualificationId',
              options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
  Future<Map<String, dynamic>> uploadQualificationEvidence(String qualificationId, String fileName, String contentType, List<int> bytes) async {
    if (bytes.isEmpty || bytes.length > 10 * 1024 * 1024) throw StateError('Credential evidence must be 10 MiB or smaller.');
    final digest = await Sha256().hash(bytes);
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) throw StateError('Sign in before uploading credential evidence.');
    final headers = {'Authorization': 'Bearer $token'};
    final response = await _dio.post<Map<String, dynamic>>('/api/v1/admin/qualifications/$qualificationId/evidence', data: {
      'fileName': fileName,
      'contentType': contentType,
      'sizeBytes': bytes.length,
      'sha256': digest.bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join(),
    }, options: Options(headers: headers));
    final upload = response.data;
    final uploadUrl = upload?['uploadUrl'];
    if (uploadUrl is! String || uploadUrl.isEmpty) throw StateError('The evidence API did not return a private upload URL.');
    final fields = Map<String, dynamic>.from(upload?['uploadFields'] as Map? ?? const {});
    await Dio().post<void>(uploadUrl, data: FormData.fromMap({
      ...fields,
      'file': MultipartFile.fromBytes(bytes, filename: fileName, contentType: DioMediaType.parse(contentType)),
    }));
    final completed = await _dio.post<Map<String, dynamic>>('/api/v1/admin/qualifications/$qualificationId/evidence/complete', options: Options(headers: headers));
    return completed.data ?? const {};
  }
  Future<void> reviewQualificationEvidence(String qualificationId, String status, String reason) async {
    final token = await _auth.validAccessToken();
    if (token == null || token.isEmpty) throw StateError('Sign in before reviewing credential evidence.');
    await _dio.put<void>('/api/v1/admin/qualifications/$qualificationId/evidence/review', data: {'status': status, 'reason': reason.trim()}, options: Options(headers: {'Authorization': 'Bearer $token'}));
  }
  Future<String> qualificationEvidenceDownload(String qualificationId) async {
    final response = await _request((token) => _dio.get<Map<String, dynamic>>('/api/v1/admin/qualifications/$qualificationId/evidence/download', options: Options(headers: {'Authorization': 'Bearer $token'})));
    final url = response.data?['downloadUrl'];
    if (url is! String || url.isEmpty) throw StateError('The evidence API did not return a download link.');
    return url;
  }
  Future<Map<String, dynamic>> staffingPolicy() async =>
      (await _request((token) => _dio.get<Map<String, dynamic>>(
              '/api/v1/admin/staffing-policy',
              options: Options(headers: {'Authorization': 'Bearer $token'}))))
          .data!;
  Future<void> updateMinimumRestMinutes(int minutes) async =>
      _command<void>(
          {'action': 'staffing-policy.update', 'minimumRestMinutes': minutes},
          (token, key) => _dio.put<void>('/api/v1/admin/staffing-policy',
              data: {'minimumRestMinutes': minutes},
              options: Options(headers: {'Authorization': 'Bearer $token', 'Idempotency-Key': key})));
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
final staffAttendanceOutboxProvider = StateNotifierProvider<StaffAttendanceOutboxController, List<Map<String, dynamic>>>((ref) {
  final controller = StaffAttendanceOutboxController(ref.watch(operationsApiProvider));
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
final eventShiftsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).shifts(id));
final staffingCoverageProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, id) =>
        ref.watch(operationsApiProvider).coverageRequirements(id));
typedef TeamAvailabilityRequest = ({String eventId, DateTime from, DateTime to});
final teamAvailabilityProvider = FutureProvider.autoDispose
    .family<List<dynamic>, TeamAvailabilityRequest>((ref, request) =>
        ref.watch(operationsApiProvider).teamAvailability(
            request.eventId, request.from, request.to));
final myUnavailabilityProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).myUnavailability());
final userNotificationsProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).notifications());

class StaffAttendanceOutboxController extends StateNotifier<List<Map<String, dynamic>>> {
  StaffAttendanceOutboxController(this._api) : super(const []);
  final OperationsApi _api;
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  Future<void>? _syncing;

  Future<void> restore() async => state = await _api.queuedOfflineAttendance();

  void watchConnectivity() {
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      if (results.any((result) => result != ConnectivityResult.none)) unawaited(synchronize());
    });
    unawaited(_connectivity.checkConnectivity().then((results) {
      if (results.any((result) => result != ConnectivityResult.none)) unawaited(synchronize());
    }, onError: (Object _) {}));
  }

  Future<bool> record(String eventId, String shiftId, String action, {bool queueForReview = false}) async {
    final online = (await _connectivity.checkConnectivity()).any((result) => result != ConnectivityResult.none);
    if (online && !queueForReview) {
      await _api.shiftCommand(eventId, shiftId, action == 'CHECK_IN' ? 'check-in' : 'check-out');
      return false;
    }
    await _api.enqueueOfflineAttendance(eventId, shiftId, action);
    await restore();
    if (online) unawaited(synchronize());
    return true;
  }

  Future<void> synchronize() async {
    final current = _syncing;
    if (current != null) return current;
    final operation = _synchronize();
    _syncing = operation;
    try { await operation; } finally { _syncing = null; }
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
