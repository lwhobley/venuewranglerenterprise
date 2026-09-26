import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/prisma.service';
import { PushNotificationsService } from '../src/push-notifications.service';

describe('PushNotificationsService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends generic alert text and only notification id/type as data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PushNotificationsService(
      { get: () => '' } as unknown as ConfigService,
      {} as PrismaService,
    );
    const send = (service as unknown as {
      sendWithRetry: (
        endpoint: string,
        accessToken: string,
        registrationToken: string,
        notification: { id: string; kind: string },
      ) => Promise<unknown>;
    }).sendWithRetry.bind(service);

    await send(
      'https://fcm.googleapis.com/test',
      'access-token',
      'device-token',
      {
        id: 'notification-1',
        kind: 'issue.assigned',
        title: 'Private incident title',
        body: 'Sensitive venue detail',
      } as { id: string; kind: string },
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.message.notification).toEqual({
      title: 'Venue Wrangler alert',
      body: 'You have an operational update. Open the app to review.',
    });
    expect(request.message.data).toEqual({
      notificationId: 'notification-1',
      kind: 'issue.assigned',
    });
    expect(JSON.stringify(request)).not.toContain('Private incident title');
    expect(JSON.stringify(request)).not.toContain('Sensitive venue detail');
  });
});
