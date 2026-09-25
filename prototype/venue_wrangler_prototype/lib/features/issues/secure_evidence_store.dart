import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import '../../config/api_configuration.dart';

class LocalIssueEvidence {
  const LocalIssueEvidence({
    required this.clientId,
    required this.encryptedPath,
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    required this.sha256,
  });

  final String clientId;
  final String encryptedPath;
  final String fileName;
  final String contentType;
  final int sizeBytes;
  final String sha256;

  Map<String, Object?> toJson() => {
        'clientId': clientId,
        'encryptedPath': encryptedPath,
        'fileName': fileName,
        'contentType': contentType,
        'sizeBytes': sizeBytes,
        'sha256': sha256,
      };

  factory LocalIssueEvidence.fromJson(Map<String, dynamic> json) =>
      LocalIssueEvidence(
        clientId: json['clientId'] as String,
        encryptedPath: json['encryptedPath'] as String,
        fileName: json['fileName'] as String,
        contentType: json['contentType'] as String,
        sizeBytes: json['sizeBytes'] as int,
        sha256: json['sha256'] as String,
      );
}

abstract interface class IssueEvidenceStore {
  Future<List<int>> decrypt(LocalIssueEvidence evidence);
  Future<void> delete(LocalIssueEvidence evidence);
}

class SecureEvidenceStore implements IssueEvidenceStore {
  SecureEvidenceStore(this._secureStorage,
      [ImagePicker? picker, Future<Directory> Function()? supportDirectory])
      : _picker = picker ?? ImagePicker(),
        _supportDirectory = supportDirectory ?? getApplicationSupportDirectory;

  static const _keyName = 'venue.issue.evidence.aes256.key';
  static const _directoryName = 'venue-wrangler-evidence';
  static const _maxBytes = 8 * 1024 * 1024;
  static final _cipher = AesGcm.with256bits();

  final FlutterSecureStorage _secureStorage;
  final ImagePicker _picker;
  final Future<Directory> Function() _supportDirectory;

  Future<LocalIssueEvidence?> capturePhoto() async {
    if (!ApiConfiguration.allowCameraEvidence) {
      throw StateError('Photo capture is disabled by your organization.');
    }
    final photo = await _picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 82,
      maxWidth: 1800,
      maxHeight: 1800,
    );
    if (photo == null) return null;
    final List<int> cleartext;
    try {
      cleartext = await photo.readAsBytes();
    } finally {
      try {
        await File(photo.path).delete();
      } on FileSystemException {
        throw StateError(
            'The temporary camera image could not be removed. Photo evidence was not saved.');
      }
    }
    if (cleartext.isEmpty || cleartext.length > _maxBytes) {
      throw StateError('Photo evidence must be between 1 byte and 8 MiB.');
    }
    final extension = photo.name.toLowerCase().split('.').last;
    final contentType = switch (extension) {
      'png' => 'image/png',
      'heic' || 'heif' => 'image/heic',
      'webp' => 'image/webp',
      _ => 'image/jpeg',
    };
    final digest = await Sha256().hash(cleartext);
    final key = await _encryptionKey();
    final encrypted = await _cipher.encrypt(cleartext,
        secretKey: key, nonce: _cipher.newNonce());
    final evidenceId = const Uuid().v4();
    final support = await _supportDirectory();
    final directory = Directory('${support.path}/$_directoryName');
    await directory.create(recursive: true);
    final path = '${directory.path}/$evidenceId.vwe';
    final payload = Uint8List.fromList([
      encrypted.nonce.length,
      ...encrypted.nonce,
      ...encrypted.cipherText,
      ...encrypted.mac.bytes,
    ]);
    await File(path).writeAsBytes(payload, flush: true);
    return LocalIssueEvidence(
      clientId: evidenceId,
      encryptedPath: path,
      fileName:
          'evidence-${evidenceId.substring(0, 8)}.${_extension(contentType)}',
      contentType: contentType,
      sizeBytes: cleartext.length,
      sha256: digest.bytes
          .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
          .join(),
    );
  }

  @override
  Future<List<int>> decrypt(LocalIssueEvidence evidence) async {
    final file = await _fileFor(evidence);
    final bytes = await file.readAsBytes();
    if (bytes.length < 30) {
      throw StateError('Encrypted photo evidence is incomplete.');
    }
    final nonceLength = bytes[0];
    if (nonceLength < 8 ||
        nonceLength > 32 ||
        bytes.length <= 1 + nonceLength + 16) {
      throw StateError('Encrypted photo evidence has an invalid format.');
    }
    final nonce = bytes.sublist(1, 1 + nonceLength);
    final mac = bytes.sublist(bytes.length - 16);
    final ciphertext = bytes.sublist(1 + nonceLength, bytes.length - 16);
    final box = SecretBox(ciphertext, nonce: nonce, mac: Mac(mac));
    final cleartext =
        await _cipher.decrypt(box, secretKey: await _encryptionKey());
    if (cleartext.length != evidence.sizeBytes) {
      throw StateError(
          'Photo evidence size does not match its saved metadata.');
    }
    final digest = await Sha256().hash(cleartext);
    final calculated = digest.bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    if (calculated != evidence.sha256) {
      throw StateError('Photo evidence integrity verification failed.');
    }
    return cleartext;
  }

  @override
  Future<void> delete(LocalIssueEvidence evidence) async {
    final file = await _fileFor(evidence);
    if (await file.exists()) await file.delete();
  }

  Future<File> _fileFor(LocalIssueEvidence evidence) async {
    final uuidV4 = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        caseSensitive: false);
    if (!uuidV4.hasMatch(evidence.clientId)) {
      throw StateError('Photo evidence has an invalid identifier.');
    }
    final support = await _supportDirectory();
    final expected =
        File('${support.path}/$_directoryName/${evidence.clientId}.vwe');
    if (File(evidence.encryptedPath).absolute.path != expected.absolute.path) {
      throw StateError(
          'Photo evidence path is outside the managed evidence store.');
    }
    if (await FileSystemEntity.type(expected.path, followLinks: false) ==
        FileSystemEntityType.link) {
      throw StateError('Photo evidence cannot be a symbolic link.');
    }
    return expected;
  }

  Future<SecretKey> _encryptionKey() async {
    final encoded = await _secureStorage.read(key: _keyName);
    if (encoded != null) return SecretKey(base64Decode(encoded));
    final key = await _cipher.newSecretKey();
    await _secureStorage.write(
        key: _keyName, value: base64Encode(await key.extractBytes()));
    return key;
  }

  String _extension(String contentType) => switch (contentType) {
        'image/png' => 'png',
        'image/heic' => 'heic',
        'image/webp' => 'webp',
        _ => 'jpg',
      };
}
