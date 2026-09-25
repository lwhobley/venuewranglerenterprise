import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/issues/secure_evidence_store.dart';

void main() {
  late Directory root;
  late Directory evidenceDirectory;
  late SecureEvidenceStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('venue-evidence-test-');
    evidenceDirectory = Directory('${root.path}/venue-wrangler-evidence');
    await evidenceDirectory.create();
    store = SecureEvidenceStore(
      const FlutterSecureStorage(),
      null,
      () async => root,
    );
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test('rejects an evidence path outside the private evidence directory',
      () async {
    final victim = File('${root.path}/keep.txt');
    await victim.writeAsString('must remain untouched');
    final evidence = _evidence(victim.path);

    await expectLater(store.delete(evidence), throwsStateError);

    expect(await victim.readAsString(), 'must remain untouched');
  });

  test('does not read a substituted path when decrypting evidence', () async {
    final outside = File('${root.path}/plaintext.txt');
    await outside.writeAsString('private content');
    final evidence = _evidence(outside.path);

    await expectLater(store.decrypt(evidence), throwsStateError);
  });

  test('deletes evidence only from the managed directory', () async {
    const evidenceId = '11111111-1111-4111-8111-111111111111';
    final managed = File('${evidenceDirectory.path}/$evidenceId.vwe');
    await managed.writeAsBytes([1, 2, 3]);

    await store.delete(_evidence(managed.path, evidenceId));

    expect(await managed.exists(), isFalse);
  });
}

LocalIssueEvidence _evidence(String encryptedPath,
        [String clientId = '22222222-2222-4222-8222-222222222222']) =>
    LocalIssueEvidence(
      clientId: clientId,
      encryptedPath: encryptedPath,
      fileName: 'evidence.png',
      contentType: 'image/png',
      sizeBytes: 12,
      sha256: List.filled(64, '0').join(),
    );
