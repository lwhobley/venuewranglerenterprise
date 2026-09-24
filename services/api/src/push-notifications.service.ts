import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import type { Identity } from './auth';
import { PrismaService } from './prisma.service';

const messagingScope = 'https://www.googleapis.com/auth/firebase.messaging';

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly projectId: string;
  private readonly auth = new GoogleAuth({ scopes: [messagingScope] });

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    this.projectId = config.get<string>('FCM_PROJECT_ID')?.trim() ?? '';
  }

  async deliver(identity: Identity, notification: { id: string; kind: string }) {
    if (!this.projectId) return;
    const devices = await this.prisma.withTenant(identity, (tx) => tx.pushDevice.findMany({
      where: { organizationId: identity.tenantId, subject: identity.subject, active: true },
      select: { id: true, registrationToken: true },
    }));
    if (devices.length === 0) return;
    const client = await this.auth.getClient();
    const access = await client.getAccessToken();
    if (!access.token) throw new Error('The Cloud Run service identity could not obtain an FCM access token.');
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`;
    const outcomes = await Promise.allSettled(devices.map(async (device) => {
      const response = await this.sendWithRetry(endpoint, access.token!, device.registrationToken, notification);
      if (response.status === 404 && response.body.includes('UNREGISTERED')) {
        await this.prisma.withTenant(identity, (tx) => tx.pushDevice.deleteMany({ where: { id: device.id, organizationId: identity.tenantId, subject: identity.subject } }));
        return;
      }
      if (!response.ok) throw new Error(`FCM returned HTTP ${response.status}.`);
    }));
    const failures = outcomes.filter((result) => result.status === 'rejected').length;
    if (failures > 0) this.logger.warn(`Push delivery had ${failures} failed device sends for a notification; the in-app notification remains available.`);
  }

  private async sendWithRetry(endpoint: string, accessToken: string, registrationToken: string, notification: { id: string; kind: string }) {
    const request = {
      message: {
        token: registrationToken,
        notification: {
          title: 'Venue Wrangler alert',
          body: 'You have an operational update. Open the app to review.',
        },
        data: { notificationId: notification.id, kind: notification.kind },
        android: { priority: 'HIGH' },
        apns: { headers: { 'apns-priority': '10' } },
      },
    };
    let lastResponse: { ok: boolean; status: number; body: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(4000),
      });
      const body = await response.text();
      lastResponse = { ok: response.ok, status: response.status, body };
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 1) return lastResponse;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
    return lastResponse!;
  }
}
