import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { EvidenceService } from '../src/evidence.service';
import type { PrismaService } from '../src/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Storage } from '@google-cloud/storage';

const admin: Identity = { subject: 'idp|admin', tenantId: 'tenant-1', capabilities: ['tenant:admin'], venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [] };
const manager: Identity = { ...admin, capabilities: ['operations:write'] };
const hospitalityRequester: Identity = { subject: 'requester-1', tenantId: 'tenant-1', capabilities: ['hospitality:order'], venueIds: ['venue-1'], eventIds: ['event-1'], locationIds: [], assignableUserIds: [] };
const bytes = Buffer.from('%PDF-1.7\nfood-handling-certificate\n%%EOF');
const digest = createHash('sha256').update(bytes).digest('hex');
const qualification = {
  id: 'qualification-1', organizationId: 'tenant-1', revokedAt: null,
  evidenceStatus: 'UPLOADING', evidenceObjectKey: 'tenants/tenant-1/qualification-1/evidence',
  evidenceFileName: 'certificate.pdf', evidenceContentType: 'application/pdf',
  evidenceSizeBytes: bytes.length, evidenceSha256: digest,
};

function harness() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    personQualification: {
      findFirst: vi.fn().mockResolvedValue(qualification),
      update: vi.fn().mockImplementation(({ data }) => ({ ...qualification, ...data })),
    },
    tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    hospitalityOrder: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', organizationId: 'tenant-1', eventId: 'event-1', venueId: 'venue-1', locationId: null, requestedBy: hospitalityRequester.subject, assignedTo: null, state: 'DISTRIBUTED', deliveryReceipt: { photoEvidenceId: 'delivery-photo-1' } }) },
    hospitalityDeliveryEvidence: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'delivery-photo-1', status: 'PENDING_UPLOAD', createdAt: new Date(), readyAt: null, ...data })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'delivery-photo-1', clientId: 'client-photo-1', fileName: 'handoff.jpg', contentType: 'image/jpeg', sizeBytes: 6, sha256: 'f'.repeat(64), status: 'READY', createdAt: new Date(), ...data })),
    },
  };
  const prisma = { withTenant: vi.fn((_identity: Identity, work: (transaction: never) => unknown) => work(tx as never)) } as unknown as PrismaService;
  const file = {
    generateSignedPostPolicyV4: vi.fn().mockResolvedValue([{ url: 'https://storage.example/upload', fields: { policy: 'signed' } }]),
    getMetadata: vi.fn().mockResolvedValue([{ size: String(bytes.length), contentType: 'application/pdf' }]),
    download: vi.fn().mockResolvedValue([bytes]),
    getSignedUrl: vi.fn().mockResolvedValue(['https://storage.example/private.pdf']),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const storage = { bucket: vi.fn(() => ({ file: vi.fn(() => file) })) } as unknown as Storage;
  const config = { get: vi.fn(() => 'private-evidence') } as unknown as ConfigService;
  return { service: new EvidenceService(prisma, config, storage), prisma, tx, file };
}

describe('qualification evidence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restricts qualification evidence upload to tenant administrators', async () => {
    const { service, prisma } = harness();
    await expect(service.createQualificationEvidence(manager, 'qualification-1', { fileName: 'certificate.pdf', contentType: 'application/pdf', sizeBytes: bytes.length, sha256: digest })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('rejects oversized or unsupported evidence before allocating storage', async () => {
    const { service, prisma } = harness();
    await expect(service.createQualificationEvidence(admin, 'qualification-1', { fileName: 'certificate.exe', contentType: 'application/octet-stream', sizeBytes: bytes.length, sha256: digest })).rejects.toThrow('PDF or supported image');
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('creates a tenant-scoped signed upload and records only its metadata', async () => {
    const { service, tx, file } = harness();
    const result = await service.createQualificationEvidence(admin, 'qualification-1', { fileName: 'certificate.pdf', contentType: 'application/pdf', sizeBytes: bytes.length, sha256: digest });
    expect(result).toEqual({ evidenceStatus: 'UPLOADING', uploadUrl: 'https://storage.example/upload', uploadFields: { policy: 'signed' } });
    expect(tx.personQualification.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ evidenceStatus: 'UPLOADING', evidenceSha256: digest, evidenceSizeBytes: bytes.length }) }));
    expect(file.generateSignedPostPolicyV4).toHaveBeenCalledOnce();
  });

  it('hash-verifies an upload before setting it pending review and auditing the change', async () => {
    const { service, tx, file } = harness();
    const result = await service.completeQualificationEvidence(admin, 'qualification-1');
    expect(file.getMetadata).toHaveBeenCalledOnce();
    expect(file.download).toHaveBeenCalledOnce();
    expect(result.evidenceStatus).toBe('PENDING_REVIEW');
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resourceType: 'qualification', changedFields: expect.arrayContaining(['evidence_status']) }) }));
  });

  it('rejects a document whose uploaded bytes do not match the declared digest', async () => {
    const { service, tx, file } = harness();
    file.download.mockResolvedValueOnce([Buffer.from('tampered')]);
    await expect(service.completeQualificationEvidence(admin, 'qualification-1')).rejects.toThrow('SHA-256 integrity check');
    expect(file.delete).toHaveBeenCalledOnce();
    expect(tx.personQualification.update).not.toHaveBeenCalled();
  });

  it('rejects content that does not match the declared MIME type', async () => {
    const { service, tx, file } = harness();
    const otherBytes = Buffer.from('not actually a pdf');
    file.download.mockResolvedValueOnce([otherBytes]);
    tx.personQualification.findFirst.mockResolvedValueOnce({ ...qualification, evidenceSha256: createHash('sha256').update(otherBytes).digest('hex') });
    await expect(service.completeQualificationEvidence(admin, 'qualification-1')).rejects.toThrow('does not match its declared file type');
    expect(file.delete).toHaveBeenCalledOnce();
    expect(tx.personQualification.update).not.toHaveBeenCalled();
  });

  it('requires tenant-admin review of pending evidence and records the reviewer rationale', async () => {
    const { service, tx } = harness();
    const result = await service.reviewQualificationEvidence(admin, 'qualification-1', 'VERIFIED', 'Issuer and expiration were checked.');
    expect(result).toMatchObject({ id: 'qualification-1', evidenceStatus: 'VERIFIED', evidenceReviewReason: 'Issuer and expiration were checked.' });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledOnce();
  });
});

describe('hospitality handoff photo evidence', () => {
  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
  const photoDigest = createHash('sha256').update(photoBytes).digest('hex');
  const photoDto = { clientId: '00000000-0000-4000-8000-000000000001', fileName: 'handoff.jpg', contentType: 'image/jpeg', sizeBytes: photoBytes.length, sha256: photoDigest };

  beforeEach(() => vi.clearAllMocks());

  it('creates a scoped signed upload for a requester and persists only safe metadata', async () => {
    const { service, tx, file } = harness();
    const result = await service.createHospitalityDeliveryUpload(hospitalityRequester, 'event-1', 'order-1', photoDto);
    expect(result).toMatchObject({ evidence: { id: 'delivery-photo-1', status: 'PENDING_UPLOAD' }, uploadUrl: 'https://storage.example/upload' });
    expect(tx.hospitalityDeliveryEvidence.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: 'tenant-1', eventId: 'event-1', orderId: 'order-1', uploadedBy: hospitalityRequester.subject,
      contentType: 'image/jpeg', sha256: photoDigest, storageObjectKey: expect.stringContaining('tenants/tenant-1/events/event-1/hospitality/order-1/receipt/'),
    }) });
    expect(file.generateSignedPostPolicyV4).toHaveBeenCalledOnce();
  });

  it('verifies image bytes and digest before marking a handoff photo ready', async () => {
    const { service, tx, file } = harness();
    file.getMetadata.mockResolvedValueOnce([{ size: String(photoBytes.length), contentType: 'image/jpeg' }]);
    file.download.mockResolvedValueOnce([photoBytes]);
    tx.hospitalityDeliveryEvidence.findFirst.mockResolvedValueOnce({ id: 'delivery-photo-1', status: 'PENDING_UPLOAD', uploadedBy: hospitalityRequester.subject, storageObjectKey: 'tenants/photo', sizeBytes: photoBytes.length, contentType: 'image/jpeg', sha256: photoDigest });
    const result = await service.completeHospitalityDeliveryUpload(hospitalityRequester, 'event-1', 'order-1', 'delivery-photo-1');
    expect(result).toMatchObject({ id: 'delivery-photo-1', status: 'READY' });
    expect(tx.hospitalityDeliveryEvidence.update).toHaveBeenCalledWith({ where: { id: 'delivery-photo-1' }, data: expect.objectContaining({ status: 'READY' }) });
  });

  it('only returns a short-lived photo URL after the photo is attached to the receipt', async () => {
    const { service, tx, file } = harness();
    tx.hospitalityDeliveryEvidence.findFirst.mockResolvedValueOnce({ id: 'delivery-photo-1', status: 'READY', storageObjectKey: 'tenants/photo', fileName: 'handoff.jpg', contentType: 'image/jpeg', sizeBytes: 6 });
    const result = await service.hospitalityDeliveryDownload(hospitalityRequester, 'event-1', 'order-1', 'delivery-photo-1');
    expect(result).toMatchObject({ id: 'delivery-photo-1', downloadUrl: 'https://storage.example/private.pdf' });
    expect(file.getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ action: 'read', expires: expect.any(Number) }));
  });
});
