import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SCIM_PROVISIONABLE_ROLES, ScimController } from './scim.controller';

const TOKEN = 'scim-test-token-0123456789abcdef0123456789';
const authHeader = `Bearer ${TOKEN}`;

function configWith(values: Record<string, string | undefined>): any {
  return { get: vi.fn((key: string) => values[key]) };
}

const configured = configWith({
  SCIM_BEARER_TOKEN: TOKEN,
  SCIM_ORGANIZATION_ID: 'org-1',
  SCIM_FACILITY_ID: 'venue-1',
});

describe('ScimController RFC 7644 Ingestion', () => {
  it('is exempt from the session AuthGuard, since IdPs authenticate with the SCIM token', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ScimController)).toBe(true);
  });

  it('fails closed when no token, organization or facility is configured', async () => {
    for (const values of [
      {},
      // The old built-in fallback token is too short to be accepted.
      { SCIM_BEARER_TOKEN: 'scim-enterprise-token', SCIM_ORGANIZATION_ID: 'org-1', SCIM_FACILITY_ID: 'venue-1' },
      { SCIM_BEARER_TOKEN: TOKEN, SCIM_FACILITY_ID: 'venue-1' },
      { SCIM_BEARER_TOKEN: TOKEN, SCIM_ORGANIZATION_ID: 'org-1' },
    ]) {
      const controller = new ScimController({} as any, configWith(values));
      await expect(controller.listUsers(authHeader)).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });

  it('rejects missing or invalid bearer tokens', async () => {
    const controller = new ScimController({} as any, configured);
    await expect(controller.listUsers(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.listUsers('Bearer scim-enterprise-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('serves RFC 7643 ServiceProviderConfig', () => {
    const controller = new ScimController({} as any, configured);
    const config = controller.getServiceProviderConfig();
    expect(config.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    expect(config.patch.supported).toBe(true);
    expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');
  });

  it('lists only profiles in the token organization', async () => {
    const prisma: any = {
      profile: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    };
    const controller = new ScimController(prisma, configured);
    await controller.listUsers(authHeader, 'userName eq "Someone@Contractor.com"');
    const where = prisma.profile.findMany.mock.calls[0][0].where;
    expect(where.venue).toEqual({ organizationId: 'org-1' });
    expect(where.email).toEqual({ equals: 'Someone@Contractor.com', mode: 'insensitive' });
    expect(prisma.profile.count.mock.calls[0][0].where).toEqual(where);
  });

  it('provisions a new user into the configured facility of the token organization', async () => {
    const prisma: any = {
      venue: { findFirst: vi.fn().mockResolvedValue({ id: 'venue-1' }) },
      profile: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'prof-1', createdAt: new Date(), updatedAt: new Date(), ...data })),
      },
    };
    const controller = new ScimController(prisma, configured);
    const scimUser = await controller.createUser(authHeader, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Coordinator@Contractor.com',
      name: { formatted: 'Alex Rivera' },
      roles: [{ value: 'event_manager', primary: true }],
      active: true,
    });

    expect(prisma.venue.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'venue-1', organizationId: 'org-1' } }));
    expect(prisma.profile.findFirst.mock.calls[0][0].where.venue).toEqual({ organizationId: 'org-1' });
    expect(prisma.profile.create.mock.calls[0][0].data).toMatchObject({ venueId: 'venue-1', email: 'coordinator@contractor.com', role: 'event_manager' });
    expect(scimUser.roles?.[0]?.value).toBe('event_manager');
  });

  it('refuses when the configured facility is outside the token organization', async () => {
    const prisma: any = { venue: { findFirst: vi.fn().mockResolvedValue(null) }, profile: { findFirst: vi.fn() } };
    const controller = new ScimController(prisma, configured);
    await expect(controller.createUser(authHeader, { userName: 'a@b.com' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.profile.findFirst).not.toHaveBeenCalled();
  });

  it('never assigns owner or administrator roles', async () => {
    const prisma: any = { venue: { findFirst: vi.fn() }, profile: { findFirst: vi.fn() } };
    const controller = new ScimController(prisma, configured);
    for (const role of ['owner', 'admin', 'platform_admin', 'organization_admin', 'fnb_director', 'not_a_role']) {
      await expect(controller.createUser(authHeader, { userName: 'a@b.com', roles: [{ value: role }] }), role)
        .rejects.toBeInstanceOf(BadRequestException);
    }
    expect(SCIM_PROVISIONABLE_ROLES).toContain('staff');
    expect(SCIM_PROVISIONABLE_ROLES).not.toContain('owner');
    expect(prisma.venue.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to modify an existing owner or administrator', async () => {
    const admin = { id: 'prof-admin', email: 'boss@contractor.com', fullName: 'Boss', role: 'owner', membershipStatus: 'active' };
    const prisma: any = {
      venue: { findFirst: vi.fn().mockResolvedValue({ id: 'venue-1' }) },
      profile: { findFirst: vi.fn().mockResolvedValue(admin), update: vi.fn() },
    };
    const controller = new ScimController(prisma, configured);
    await expect(controller.createUser(authHeader, { userName: 'boss@contractor.com', roles: [{ value: 'staff' }] }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(controller.patchUser(authHeader, 'prof-admin', { Operations: [{ op: 'replace', path: 'active', value: false }] }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(controller.deleteUser(authHeader, 'prof-admin')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('deactivates a user in the token organization via PATCH', async () => {
    const existingProfile = { id: 'prof-1', email: 'exiting@contractor.com', fullName: 'Sam Stone', role: 'staff', membershipStatus: 'active' };
    const prisma: any = {
      profile: {
        findFirst: vi.fn().mockResolvedValue(existingProfile),
        update: vi.fn().mockImplementation(async ({ data }) => ({ ...existingProfile, ...data })),
      },
    };
    const controller = new ScimController(prisma, configured);
    const patched = await controller.patchUser(authHeader, 'prof-1', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });
    expect(prisma.profile.findFirst.mock.calls[0][0].where).toEqual({ id: 'prof-1', venue: { organizationId: 'org-1' } });
    expect(patched.active).toBe(false);
  });

  it('returns 404 for a user in another organization', async () => {
    const prisma: any = { profile: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    const controller = new ScimController(prisma, configured);
    await expect(controller.getUser(authHeader, 'other-tenant')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.deleteUser(authHeader, 'other-tenant')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });
});
