import { Injectable, NotFoundException } from '@nestjs/common';
import { assertCapability, Identity } from './auth';
import { PrismaService } from './prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: Identity) {
    assertCapability(identity, 'notification:read');
    return this.prisma.withTenant(identity, (tx) => tx.userNotification.findMany({
      where: { recipientSubject: identity.subject },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }));
  }

  async markRead(identity: Identity, notificationId: string) {
    assertCapability(identity, 'notification:read');
    return this.prisma.withTenant(identity, async (tx) => {
      const notification = await tx.userNotification.findFirst({
        where: { id: notificationId, recipientSubject: identity.subject },
      });
      if (!notification) throw new NotFoundException('Notification not found.');
      if (notification.readAt) return notification;
      return tx.userNotification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    });
  }
}
