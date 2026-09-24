import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { assertCapability, Identity } from './auth';
import { RegisterPushDeviceDto } from './push-devices.dto';
import { PrismaService } from './prisma.service';

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async register(identity: Identity, dto: RegisterPushDeviceDto) {
    assertCapability(identity, 'notification:read');
    if (!this.config.get<string>('FCM_PROJECT_ID')?.trim()) throw new ServiceUnavailableException('Push notifications are not configured for this service.');
    const tokenSha256 = createHash('sha256').update(dto.registrationToken).digest('hex');
    return this.prisma.withTenant(identity, async (tx) => {
      const existing = await tx.pushDevice.findFirst({ where: { organizationId: identity.tenantId, installationId: dto.installationId } });
      if (existing && existing.subject !== identity.subject) throw new ConflictException('This device is registered to another account. Sign out from that account before switching users.');
      try {
        const device = await tx.pushDevice.upsert({
          where: { organizationId_installationId: { organizationId: identity.tenantId, installationId: dto.installationId } },
          create: {
            organizationId: identity.tenantId,
            subject: identity.subject,
            installationId: dto.installationId,
            registrationToken: dto.registrationToken,
            tokenSha256,
            platform: dto.platform,
          },
          update: { registrationToken: dto.registrationToken, tokenSha256, platform: dto.platform, active: true },
          select: { id: true, active: true, platform: true, updatedAt: true },
        });
        return device;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ConflictException('This notification token is already registered to another installation in your organization.');
        throw error;
      }
    });
  }

  async revoke(identity: Identity, installationId: string) {
    assertCapability(identity, 'notification:read');
    return this.prisma.withTenant(identity, async (tx) => {
      const result = await tx.pushDevice.deleteMany({ where: { organizationId: identity.tenantId, installationId, subject: identity.subject } });
      if (result.count === 0) throw new NotFoundException('Notification device not found.');
      return { removed: true };
    });
  }
}
