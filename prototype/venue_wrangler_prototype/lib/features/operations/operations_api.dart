import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';
import '../../auth/auth.dart';
import '../../config/api_configuration.dart';

class OperationsApi {
  OperationsApi(this._auth, this._storage)
      : _dio = Dio(BaseOptions(baseUrl: ApiConfiguration.baseUrl));
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
  Future<List<dynamic>> tasks(String eventId) => _cachedGet(
      'tasks.$eventId',
      () async =>
          (await _request((token) => _dio.get<List<dynamic>>(
                  '/api/v1/events/$eventId/tasks',
                  options:
                      Options(headers: {'Authorization': 'Bearer $token'}))))
              .data ??
          const []);
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
    final token = await _auth.validAccessToken();
    if (token == null) throw StateError('Sign in again to continue.');
    await _dio.post<void>(
      '/api/v1/events/$eventId/issues/$issueId/$action',
      data: action == 'assign'
          ? {'ownerId': ownerId, 'reason': reason}
          : {'reason': reason},
      options: Options(headers: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': const Uuid().v4(),
      }),
    );
  }

  Future<void> updateTask(
          String eventId, String taskId, Map<String, Object?> patch) async =>
      _request((token) => _dio.put<void>(
          '/api/v1/events/$eventId/tasks/$taskId',
          data: patch,
          options: Options(headers: {'Authorization': 'Bearer $token'})));
  Future<void> createTask(String eventId, Map<String, Object?> task) async =>
      _request((token) => _dio.post<void>('/api/v1/events/$eventId/tasks',
          data: task,
          options: Options(headers: {'Authorization': 'Bearer $token'})));
  Future<void> createVenue(String name) async =>
      _request((token) => _dio.post<void>('/api/v1/admin/venues',
          data: {'name': name},
          options: Options(headers: {'Authorization': 'Bearer $token'})));
  Future<void> createLocation(String venueId, String name) async =>
      _request((token) => _dio.post<void>('/api/v1/admin/locations',
          data: {'venueId': venueId, 'name': name},
          options: Options(headers: {'Authorization': 'Bearer $token'})));
  Future<void> createEvent(
          String venueId, String name, DateTime startsAt) async =>
      _request((token) => _dio.post<void>('/api/v1/admin/events',
          data: {
            'venueId': venueId,
            'name': name,
            'startsAt': startsAt.toUtc().toIso8601String()
          },
          options: Options(headers: {'Authorization': 'Bearer $token'})));
  Future<void> savePerson(
          String subject, String email, String displayName) async =>
      _request((token) => _dio.post<void>('/api/v1/admin/people',
          data: {
            'externalSubject': subject,
            'email': email,
            'displayName': displayName
          },
          options: Options(headers: {'Authorization': 'Bearer $token'})));
}

final operationsApiProvider = Provider((ref) => OperationsApi(
    ref.watch(authRepositoryProvider), const FlutterSecureStorage()));
final operationsBootstrapProvider = FutureProvider.autoDispose(
    (ref) => ref.watch(operationsApiProvider).bootstrap());
final eventIssuesProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).issues(id));
final eventTasksProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, id) => ref.watch(operationsApiProvider).tasks(id));
final userNotificationsProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.watch(operationsApiProvider).notifications());
