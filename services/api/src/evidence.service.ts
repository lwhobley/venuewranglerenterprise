import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentStatus } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import { assertScope, Identity } from './auth';
import { CreateEvidenceUploadDto } from './evidence.dto';
import { PrismaService } from './prisma.service';

const supportedContentTypes = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
const maximumAttachmentCount = 5;

@Injectable()
export class EvidenceService {
  private readonly storage = new Storage();
  private readonly bucketName: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
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

  private object(name: string) {
    if (!this.bucketName) throw new ServiceUnavailableException('Issue evidence storage has not been configured.');
    return this.storage.bucket(this.bucketName).file(name);
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
