import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { IntegrationService } from '../src/integration.service';
import type { PrismaService } from '../src/prisma.service';

const secret = 'test-integration-secret-with-at-least-32-bytes';
const tenantId = '00000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const venueId = '10000000-0000-4000-8000-000000000001';
const locationId = '30000000-0000-4000-8000-000000000001';

function service(currentTask: Record<string, unknown> | null = null) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([1]),
    event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: locationId }) },
    externalIntegrationEvent: {
      create: vi.fn().mockResolvedValue({ id: 'event-record' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    operationalTask: {
      findFirst: vi.fn().mockResolvedValue(currentTask),
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'task-record', ...data })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'task-record', ...data })),
    },
    operationalTaskAudit: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    withTenant: vi.fn((_identity, callback) => callback(tx)),
  } as unknown as PrismaService;
  const config = {
    get: vi.fn((key: string) => key === 'INTEGRATION_PROVIDERS_JSON' ? JSON.stringify([{
      id: 'arena-labor', organizationSlug: 'harbor-city', tenantId, secret,
    }]) : undefined),
  } as unknown as ConfigService;
  return { service: new IntegrationService(config, prisma), tx };
}

function request(payload: Record<string, unknown>) {
  const body = {
    venueEventId: eventId,
    externalId: `labor-event-${Date.now()}`,
    eventType: 'operations.task.upserted',
    occurredAt: new Date().toISOString(),
    payload,
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex');
  return { body, rawBody, timestamp, signature };
}

describe('IntegrationService operational task mapping', () => {
  it('lists event-scoped connector activity without returning imported payloads', async () => {
    const { service: integration, tx } = service();
    const result = await integration.list({
      subject: 'manager-1',
      tenantId,
      capabilities: ['operations:read'],
      eventIds: [eventId],
      venueIds: [venueId],
      locationIds: [],
      assignableUserIds: [],
    }, eventId);

    expect(result).toEqual([]);
    expect(tx.externalIntegrationEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: tenantId, eventId }),
      select: expect.not.objectContaining({ payload: true }),
    }));
  });

  it('creates a tenant-scoped, auditable task from a signed normalized event', async () => {
    const { service: integration, tx } = service();
    const signed = request({
      externalTaskId: 'shift-42',
      kind: 'STAFFING',
      title: 'Fill guest services shift',
      locationId,
      dueAt: '2026-10-03T18:00:00Z',
      expectedQuantity: 12,
      unit: 'staff',
    });

    const result = await integration.ingest('arena-labor', signed.timestamp, signed.signature, signed.rawBody, signed.body);

    expect(result.replayed).toBe(false);
    if (!('task' in result)) throw new Error('The first delivery should include the created task.');
    expect(result.task).toMatchObject({
      id: 'task-record', organizationId: tenantId, eventId, venueId,
      externalSource: 'arena-labor', externalTaskId: 'shift-42',
      kind: 'STAFFING', title: 'Fill guest services shift', state: 'OPEN',
    });
    expect(tx.operationalTask.create).toHaveBeenCalledOnce();
    expect(tx.operationalTaskAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'integration:arena-labor', action: 'integration.created' }),
    }));
  });

  it('updates only the matching source-owned task and leaves workflow state and assignment alone', async () => {
    const currentTask = {
      id: 'task-record', organizationId: tenantId, eventId, state: 'IN_PROGRESS',
      ownerId: 'manager-assignee', title: 'Earlier shift title',
    };
    const { service: integration, tx } = service(currentTask);
    const signed = request({ externalTaskId: 'shift-42', kind: 'STAFFING', title: 'Updated shift coverage' });

    await integration.ingest('arena-labor', signed.timestamp, signed.signature, signed.rawBody, signed.body);

    expect(tx.operationalTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-record' },
      data: expect.objectContaining({ title: 'Updated shift coverage', updatedBy: 'integration:arena-labor' }),
    }));
    const updateData = tx.operationalTask.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('state');
    expect(updateData).not.toHaveProperty('ownerId');
    expect(tx.operationalTaskAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'integration.updated', actorId: 'integration:arena-labor' }),
    }));
  });

  it('rejects a mapped task location outside the configured event venue', async () => {
    const { service: integration, tx } = service();
    tx.location.findFirst.mockResolvedValue(null);
    const signed = request({ externalTaskId: 'shift-42', kind: 'STAFFING', title: 'Fill guest services shift', locationId });

    await expect(integration.ingest('arena-labor', signed.timestamp, signed.signature, signed.rawBody, signed.body))
      .rejects.toThrow('The task location must belong to the mapped venue event.');
    expect(tx.operationalTask.create).not.toHaveBeenCalled();
  });

  it('defers polling inside the source interval and does not call the remote page', async () => {
    const checkpoint = { findUnique: vi.fn().mockResolvedValue({ cursor: 'page-1', nextPollAt: new Date(Date.now() + 60_000), consecutiveFailures: 0 }), upsert: vi.fn() };
    const tx = { integrationSourceCheckpoint: checkpoint, integrationDeadLetter: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() } };
    const prisma = { withTenant: vi.fn((_identity, callback) => callback(tx)) } as unknown as PrismaService;
    const config = { get: vi.fn(() => JSON.stringify([{ id: 'arena-labor', organizationSlug: 'harbor-city', tenantId, secret, pollUrl: 'https://poll.example/feed' }])) } as unknown as ConfigService;
    const integration = new IntegrationService(config, prisma);
    const fetcher = vi.fn();
    await expect(integration.poll({ subject: 'admin', tenantId, organizationSlug: 'harbor-city', capabilities: ['tenant:admin'], venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [] }, 'arena-labor', fetcher)).rejects.toThrow('polling interval');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
