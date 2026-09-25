import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentStatus } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import { assertScope, assertTenantAdmin, Identity } from './auth';
import { CreateEvidenceUploadDto, CreateQualificationEvidenceDto } from './evidence.dto';
import { PrismaService } from './prisma.service';

const supportedContentTypes = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
const maximumAttachmentCount = 5;

@Injectable()
export class EvidenceService {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService, storage?: Storage) {
    this.storage = storage ?? new Storage();
    this.bucketName = config.get<string>('EVIDENCE_BUCKET') ?? '';
  }

  async createUpload(identity: Identity, eventId: string, issueId: string, dto: CreateEvidenceUploadDto) {
    const row = await this.prisma.withTenant(identity, async (tx) => {
      const issue = await tx.issue.findFirst({ where: { id: issueId, eventId } });
      if (!issue) throw new NotFoundException('Issue not found.');
      assertScope(identity, 'issue:evidence', eventId, issue.venueId, issue.locationId ?? undefined);
      if (!supportedContentTypes.has(dto.contentType) || dto.sizeBytes > 8 * 1024 * 1024) throw new BadRequestException('Evidence must be a supported image no larger than 8 MiB.');

      const existing = await tx.issueAttachment.findUnique({ where: { issueId_clientId: { issueId, clientId: dto.clientId } } });
      if (existing) {
        if (existing.organizationId !== identity.tenantId || existing.eventId !== eventId || existing.uploadedBy !== identity.subject || existing.contentType !== dto.contentType || existing.sizeBytes !== dto.sizeBytes || existing.sha256 !== dto.sha256) throw new ConflictException('This evidence upload ID was already used for different content.');
        return existing;
      }
      const count = await tx.issueAttachment.count({ where: { issueId } });
      if (count >= maximumAttachmentCount) throw new ConflictException(`An issue can have at most ${maximumAttachmentCount} evidence images.`);
      const fileName = dto.fileName.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 200) || 'evidence-image';
      return tx.issueAttachment.create({ data: {
        organizationId: identity.tenantId,
        eventId,
        issueId,
        clientId: dto.clientId,
        uploadedBy: identity.subject,
        fileName,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        sha256: dto.sha256,
        storageObjectKey: `tenants/${identity.tenantId}/events/${eventId}/issues/${issueId}/${randomUUID()}`,
      } });
    });
    if (row.status === AttachmentStatus.READY) return { attachment: this.publicAttachment(row), uploadUrl: null, uploadFields: {} };
    const file = this.object(row.storageObjectKey);
    const [uploadPolicy] = await file.generateSignedPostPolicyV4({
      expires: Date.now() + 10 * 60 * 1000,
      fields: { 'Content-Type': row.contentType },
      conditions: [
        { 'Content-Type': row.contentType },
        ['content-length-range', row.sizeBytes, row.sizeBytes],
      ],
    });
    return { attachment: this.publicAttachment(row), uploadUrl: uploadPolicy.url, uploadFields: uploadPolicy.fields };
  }

  async completeUpload(identity: Identity, eventId: string, issueId: string, attachmentId: string) {
    const attachment = await this.prisma.withTenant(identity, async (tx) => {
      const issue = await tx.issue.findFirst({ where: { id: issueId, eventId } });
      if (!issue) throw new NotFoundException('Issue not found.');
      assertScope(identity, 'issue:evidence', eventId, issue.venueId, issue.locationId ?? undefined);
      const row = await tx.issueAttachment.findFirst({ where: { id: attachmentId, issueId, eventId, uploadedBy: identity.subject } });
      if (!row) throw new NotFoundException('Evidence upload not found.');
      return row;
    });
    if (attachment.status === AttachmentStatus.READY) return this.publicAttachment(attachment);

    const file = this.object(attachment.storageObjectKey);
    let metadata: { size?: string | number; contentType?: string };
    let bytes: Buffer;
    try {
      const [remoteMetadata] = await file.getMetadata();
      metadata = remoteMetadata;
    } catch {
      throw new ConflictException('The evidence image has not finished uploading. Retry after the upload completes.');
    }
    if (Number(metadata.size) !== attachment.sizeBytes || metadata.contentType !== attachment.contentType) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw new BadRequestException('The uploaded evidence does not match the declared size and type.');
    }
    try {
      const [download] = await file.download();
      bytes = download;
    } catch {
      throw new ConflictException('The evidence image could not be verified. Retry after the upload completes.');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw new BadRequestException('The uploaded evidence does not match the declared size, type, and SHA-256 digest.');
    }
    const updated = await this.prisma.withTenant(identity, (tx) => tx.issueAttachment.update({
      where: { id: attachment.id },
      data: { status: AttachmentStatus.READY, readyAt: new Date() },
    }));
    return this.publicAttachment(updated);
  }

  async list(identity: Identity, eventId: string, issueId: string) {
    const rows = await this.prisma.withTenant(identity, async (tx) => {
      const issue = await tx.issue.findFirst({ where: { id: issueId, eventId } });
      if (!issue) throw new NotFoundException('Issue not found.');
      assertScope(identity, 'issue:read', eventId, issue.venueId, issue.locationId ?? undefined);
      return tx.issueAttachment.findMany({ where: { issueId, eventId, status: AttachmentStatus.READY }, orderBy: { createdAt: 'asc' } });
    });
    return Promise.all(rows.map(async (row) => {
      const [downloadUrl] = await this.object(row.storageObjectKey).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000 });
      return { id: row.id, fileName: row.fileName, contentType: row.contentType, sizeBytes: row.sizeBytes, createdAt: row.createdAt, downloadUrl };
    }));
  }

  async createQualificationEvidence(identity: Identity, qualificationId: string, dto: CreateQualificationEvidenceDto) {
    assertTenantAdmin(identity);
    const supported = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']);
    if (!supported.has(dto.contentType) || dto.sizeBytes > 10 * 1024 * 1024) throw new BadRequestException('Credential evidence must be a PDF or supported image no larger than 10 MiB.');
    const safeName = dto.fileName.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 200) || 'credential-evidence';
    const row = await this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`qualification-evidence:${identity.tenantId}:${qualificationId}`}, 0))`;
      const current = await tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, revokedAt: null } });
      if (!current) throw new NotFoundException('Active qualification not found in this organization.');
      if (current.evidenceStatus === 'PENDING_REVIEW' || current.evidenceStatus === 'VERIFIED') throw new ConflictException('This credential already has evidence under review or verified.');
      const key = current.evidenceObjectKey ?? `tenants/${identity.tenantId}/qualifications/${qualificationId}/${randomUUID()}`;
      if (current.evidenceObjectKey && current.evidenceStatus === 'REJECTED') await this.object(current.evidenceObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      return tx.personQualification.update({ where: { id: current.id }, data: {
        evidenceStatus: 'UPLOADING', evidenceObjectKey: key, evidenceFileName: safeName,
        evidenceContentType: dto.contentType, evidenceSizeBytes: dto.sizeBytes, evidenceSha256: dto.sha256,
        evidenceUploadedAt: null, evidenceReviewedBy: null, evidenceReviewedAt: null, evidenceReviewReason: null,
      } });
    });
    const [policy] = await this.object(row.evidenceObjectKey!).generateSignedPostPolicyV4({
      expires: Date.now() + 10 * 60 * 1000,
      fields: { 'Content-Type': dto.contentType },
      conditions: [{ 'Content-Type': dto.contentType }, ['content-length-range', dto.sizeBytes, dto.sizeBytes]],
    });
    return { evidenceStatus: row.evidenceStatus, uploadUrl: policy.url, uploadFields: policy.fields };
  }

  async completeQualificationEvidence(identity: Identity, qualificationId: string) {
    assertTenantAdmin(identity);
    const row = await this.prisma.withTenant(identity, (tx) => tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, revokedAt: null } }));
    if (!row || !row.evidenceObjectKey || row.evidenceStatus !== 'UPLOADING' || !row.evidenceContentType || !row.evidenceSizeBytes || !row.evidenceSha256) throw new NotFoundException('Credential evidence upload was not found.');
    const file = this.object(row.evidenceObjectKey);
    try {
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) !== row.evidenceSizeBytes || metadata.contentType !== row.evidenceContentType) throw new BadRequestException('The uploaded credential does not match its declared size and type.');
      const [bytes] = await file.download();
      if (createHash('sha256').update(bytes).digest('hex') !== row.evidenceSha256) throw new BadRequestException('The uploaded credential failed its SHA-256 integrity check.');
      if (!this.matchesEvidenceType(bytes, row.evidenceContentType)) throw new BadRequestException('The uploaded credential content does not match its declared file type.');
    } catch (error) {
      if (error instanceof BadRequestException) await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      if (error instanceof BadRequestException) throw error;
      throw new ConflictException('Credential evidence is not uploaded or could not be verified. Retry after the upload completes.');
    }
    const updated = await this.prisma.withTenant(identity, async (tx) => {
      const current = await tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, evidenceStatus: 'UPLOADING' } });
      if (!current) throw new ConflictException('Credential evidence changed before verification completed.');
      const saved = await tx.personQualification.update({ where: { id: current.id }, data: { evidenceStatus: 'PENDING_REVIEW', evidenceUploadedAt: new Date() } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'qualification', resourceId: current.id, changedFields: ['evidence_status', 'evidence_file_name', 'evidence_uploaded_at'] } });
      return saved;
    });
    return { id: updated.id, evidenceStatus: updated.evidenceStatus, evidenceFileName: updated.evidenceFileName, evidenceUploadedAt: updated.evidenceUploadedAt };
  }

  async reviewQualificationEvidence(identity: Identity, qualificationId: string, status: 'VERIFIED' | 'REJECTED', reason: string) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`qualification-evidence:${identity.tenantId}:${qualificationId}`}, 0))`;
      const current = await tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, evidenceStatus: 'PENDING_REVIEW' } });
      if (!current) throw new NotFoundException('Credential evidence awaiting review was not found.');
      const updated = await tx.personQualification.update({ where: { id: current.id }, data: { evidenceStatus: status, evidenceReviewedBy: identity.subject, evidenceReviewedAt: new Date(), evidenceReviewReason: reason.trim() } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'qualification', resourceId: current.id, changedFields: ['evidence_status', 'evidence_reviewed_at', 'evidence_review_reason'] } });
      return { id: updated.id, evidenceStatus: updated.evidenceStatus, evidenceReviewedAt: updated.evidenceReviewedAt, evidenceReviewReason: updated.evidenceReviewReason };
    });
  }

  async qualificationEvidenceDownload(identity: Identity, qualificationId: string) {
    assertTenantAdmin(identity);
    const row = await this.prisma.withTenant(identity, (tx) => tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, evidenceStatus: { in: ['PENDING_REVIEW', 'VERIFIED', 'REJECTED'] } } }));
    if (!row?.evidenceObjectKey) throw new NotFoundException('Credential evidence was not found.');
    const [downloadUrl] = await this.object(row.evidenceObjectKey).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000 });
    return { fileName: row.evidenceFileName, contentType: row.evidenceContentType, evidenceStatus: row.evidenceStatus, downloadUrl };
  }

  private object(name: string) {
    if (!this.bucketName) throw new ServiceUnavailableException('Issue evidence storage has not been configured.');
    return this.storage.bucket(this.bucketName).file(name);
  }

  private matchesEvidenceType(bytes: Buffer, contentType: string) {
    if (contentType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (contentType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (contentType === 'image/heic') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(bytes.subarray(8, 12).toString('ascii'));
    return false;
  }

  private publicAttachment(row: {
    id: string;
    clientId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: AttachmentStatus;
    createdAt: Date;
    readyAt: Date | null;
  }) {
    return {
      id: row.id,
      clientId: row.clientId,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: row.createdAt,
      readyAt: row.readyAt,
    };
  }
}
