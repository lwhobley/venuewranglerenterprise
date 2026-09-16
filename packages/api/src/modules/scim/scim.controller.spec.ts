import { describe, expect, it, vi } from 'vitest';
import { ScimController } from './scim.controller';

describe('ScimController RFC 7644 Ingestion', () => {
  const authHeader = 'Bearer scim-enterprise-token';

  const mockConfig: any = {
    get: vi.fn((key: string) => {
      if (key === 'SCIM_BEARER_TOKEN') return 'scim-enterprise-token';
      return null;
    }),
  };

  it('rejects unauthenticated requests or invalid bearer tokens', async () => {
    const prisma: any = {};
    const controller = new ScimController(prisma, mockConfig);

    await expect(controller.listUsers(undefined as any)).rejects.toThrow('Missing or invalid SCIM Bearer token');
    await expect(controller.listUsers('Bearer invalid-token')).rejects.toThrow('Unauthorized SCIM token');
  });

  it('serves RFC 7643 ServiceProviderConfig', () => {
    const prisma: any = {};
    const controller = new ScimController(prisma, mockConfig);
    const config = controller.getServiceProviderConfig();

    expect(config.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    expect(config.patch.supported).toBe(true);
    expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');
  });

  it('provisions a new SCIM user and returns 201 with SCIM user schema', async () => {
    let createdProfile: any = null;
    const prisma: any = {
      venue: { findFirst: vi.fn().mockResolvedValue({ id: 'venue-1' }) },
      profile: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdProfile = { id: 'prof-1', createdAt: new Date(), updatedAt: new Date(), ...data };
          return createdProfile;
        }),
      },
    };

    const controller = new ScimController(prisma, mockConfig);
    const scimUser = await controller.createUser(authHeader, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'coordinator@contractor.com',
      name: { formatted: 'Alex Rivera', givenName: 'Alex', familyName: 'Rivera' },
      roles: [{ value: 'event_manager', primary: true }],
      active: true,
    });

    expect(scimUser.userName).toBe('coordinator@contractor.com');
    expect(scimUser.displayName).toBe('Alex Rivera');
    expect(scimUser.active).toBe(true);
    expect(scimUser.roles?.[0]?.value).toBe('event_manager');
    expect(prisma.profile.create).toHaveBeenCalled();
  });

  it('deactivates and deprovisions user via SCIM PATCH', async () => {
    const existingProfile = {
      id: 'prof-1',
      email: 'exiting@contractor.com',
      fullName: 'Sam Stone',
      role: 'staff',
      membershipStatus: 'active',
    };

    let updatedProfile: any = null;
    const prisma: any = {
      profile: {
        findUnique: vi.fn().mockResolvedValue(existingProfile),
        update: vi.fn().mockImplementation(async ({ data }) => {
          updatedProfile = { ...existingProfile, ...data };
          return updatedProfile;
        }),
      },
    };

    const controller = new ScimController(prisma, mockConfig);
    const patched = await controller.patchUser(authHeader, 'prof-1', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });

    expect(patched.active).toBe(false);
    expect(updatedProfile.membershipStatus).toBe('revoked');
  });
});
