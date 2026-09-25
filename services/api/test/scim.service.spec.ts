import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { ScimService } from '../src/scim.service';
import type { PrismaService } from '../src/prisma.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const provider = {
  organizationSlug: 'harbor-city',
  tenantId,
  bearerToken: 'scim-token-long-enough-for-a-secure-test',
};
const identity: Identity = {
  subject: 'scim:harbor-city',
  tenantId,
  capabilities: [],
  venueIds: [],
  eventIds: [],
  locationIds: [],
  assignableUserIds: [],
};

function service(tx: Record<string, unknown>) {
  const prisma = {
    withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => key === 'SCIM_PROVIDERS_JSON' ? JSON.stringify([provider]) : '[]',
  } as unknown as ConfigService;
  const authProviders = {
    forOrganization: () => ({ providers: [{ issuer: 'https://idp.example.invalid' }] }),
    forIssuer: () => ({ tenantId }),
  } as never;
  return new ScimService(config, prisma, authProviders);
}

describe('SCIM roster audit', () => {
  it('records roster creation as changed field names without copying personal values', async () => {
    const person = {
      id: 'person-1',
      externalSubject: 'https://idp.example.invalid|worker-1',
      email: 'worker@example.invalid',
      displayName: 'Worker One',
      active: true,
      createdAt: new Date('2026-09-25T12:00:00.000Z'),
      updatedAt: new Date('2026-09-25T12:00:00.000Z'),
    };
    const tx = {
      person: { create: vi.fn().mockResolvedValue(person) },
      personAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };

    await service(tx).createUser(identity, {
      externalId: person.externalSubject,
      userName: person.email,
      displayName: person.displayName,
    });

    expect(tx.personAuditEvent.create).toHaveBeenCalledWith({
      data: {
        organizationId: tenantId,
        personId: person.id,
        actorId: identity.subject,
        action: 'created',
        changedFields: ['external_subject', 'email', 'display_name', 'active'],
      },
    });
    const auditData = tx.personAuditEvent.create.mock.calls[0][0].data;
    expect(JSON.stringify(auditData)).not.toContain(person.email);
    expect(JSON.stringify(auditData)).not.toContain(person.displayName);
  });

  it('records the active-to-inactive transition on SCIM deactivation', async () => {
    const person = {
      id: 'person-2',
      externalSubject: 'https://idp.example.invalid|worker-2',
      email: 'worker2@example.invalid',
      displayName: 'Worker Two',
      active: true,
      createdAt: new Date('2026-09-25T12:00:00.000Z'),
      updatedAt: new Date('2026-09-25T12:00:00.000Z'),
    };
    const tx = {
      person: { findFirst: vi.fn().mockResolvedValue(person), update: vi.fn().mockResolvedValue({ ...person, active: false }) },
      personAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };

    await service(tx).deactivateUser(identity, person.id);

    expect(tx.personAuditEvent.create).toHaveBeenCalledWith({
      data: {
        organizationId: tenantId,
        personId: person.id,
        actorId: identity.subject,
        action: 'deactivated',
        changedFields: ['active'],
      },
    });
  });
});
