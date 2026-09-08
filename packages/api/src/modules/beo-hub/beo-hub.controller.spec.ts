import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { BeoHubController } from './beo-hub.controller';

describe('BeoHubController', () => {
  let controller: BeoHubController;
  let mockPrisma: any;
  let mockBeoIngestService: any;
  let mockDailyRosterService: any;

  beforeEach(() => {
    mockPrisma = {
      venue: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      crmBeo: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      facilityZone: {
        findFirst: vi.fn(),
      },
      subVenue: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      suiteBeoOrder: {
        create: vi.fn(),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      userAreaOverride: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') return cb(mockPrisma);
        return cb;
      }),
    };

    mockBeoIngestService = {
      ingestCanonicalBeo: vi.fn(),
    };

    mockDailyRosterService = {
      syncBanquetStaffToRoster: vi.fn().mockResolvedValue({
        roster: { id: 'roster-123' },
      }),
    };

    controller = new BeoHubController(
      mockPrisma as any,
      mockBeoIngestService as any,
      mockDailyRosterService as any,
    );
  });

  describe('Webhook Security & Fail-Closed Behavior', () => {
    it('fails closed (401) in production when secret is missing or venue has no secret', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockPrisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        leadsWebhookSecret: null,
      });

      try {
        await expect(
          controller.handleWebhookIngest('generic-json', 'venue-1', undefined, undefined, {
            id: 'webhook-1',
            eventName: 'Unauthenticated Webhook',
          })
        ).rejects.toThrow(UnauthorizedException);
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('rejects with 401 when provided secret does not match expected secret', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        leadsWebhookSecret: 'correct-secret-12345',
      });

      await expect(
        controller.handleWebhookIngest('generic-json', 'venue-1', 'wrong-secret', undefined, {
          id: 'webhook-1',
          eventName: 'Tampered Webhook',
        })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 400 for unknown source adapter', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        leadsWebhookSecret: 'secret-1',
      });

      await expect(
        controller.handleWebhookIngest('salesforce-unknown', 'venue-1', 'secret-1', undefined, {
          id: 'webhook-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 200 with duplicate=true on duplicate webhook delivery', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        leadsWebhookSecret: 'secret-1',
      });

      mockBeoIngestService.ingestCanonicalBeo.mockResolvedValue({
        id: 'beo-duplicate-1',
        externalSource: 'generic-json',
        externalId: 'EXT-DUP-1',
        status: 'confirmed',
        isDuplicate: true,
        needsReview: false,
        eventId: 'evt-1',
      });

      const res = await controller.handleWebhookIngest('generic-json', 'venue-1', 'secret-1', undefined, {
        id: 'EXT-DUP-1',
        title: 'Board Dinner',
        space: 'Private Room',
        startTime: '2026-10-01T18:00:00Z',
        endTime: '2026-10-01T21:00:00Z',
      });

      expect(res.ok).toBe(true);
      expect(res.id).toBe('beo-duplicate-1');
      expect(res.duplicate).toBe(true);
    });
  });

  describe('Manual Creation & Validation', () => {
    const managerScope = {
      venueId: 'venue-1',
      userId: 'mgr-1',
      role: 'manager',
      allAccess: false,
    } as any;

    it('rejects manual creation missing required space', async () => {
      await expect(
        controller.createManualBeo(managerScope, {
          eventName: 'VIP Reception',
          venueSpace: '',
          serviceDate: '2026-09-08',
          serviceStartAt: '2026-09-08T18:00:00Z',
          serviceEndAt: '2026-09-08T22:00:00Z',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-managers from creating BEOs', async () => {
      const staffScope = {
        venueId: 'venue-1',
        userId: 'staff-1',
        role: 'server',
        allAccess: false,
      } as any;

      await expect(
        controller.createManualBeo(staffScope, {
          eventName: 'VIP Reception',
          venueSpace: 'Suite 1',
          serviceDate: '2026-09-08',
          serviceStartAt: '2026-09-08T18:00:00Z',
          serviceEndAt: '2026-09-08T22:00:00Z',
        })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Staffing & Suite Order Integration', () => {
    const managerScope = {
      venueId: 'venue-1',
      userId: 'mgr-1',
      role: 'manager',
      allAccess: false,
    } as any;

    it('syncs staffing slice to daily roster banquet-sync', async () => {
      mockPrisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-10',
        eventName: 'Founders Gala',
        venueSpace: 'Grand Ballroom',
        serviceDate: '2026-09-10',
        guestCount: 150,
        departmentSlices: {
          staffing: {
            requiredRoles: [
              { role: 'Banquet Captain', count: 1 },
              { role: 'Server', count: 5 },
            ],
          },
        },
      });

      mockPrisma.venue.findUniqueOrThrow.mockResolvedValue({
        id: 'venue-1',
        organizationId: 'org-1',
      });

      mockPrisma.crmBeo.update.mockResolvedValue({});

      const res = await controller.syncBeoStaffing(managerScope, 'beo-10');
      expect(res.ok).toBe(true);
      expect(res.rosterId).toBe('roster-123');
      expect(res.workersSynced).toBe(6);
      expect(mockDailyRosterService.syncBanquetStaffToRoster).toHaveBeenCalledOnce();
    });
  });

  describe('Department Isolation on BEO Slices', () => {
    const cookScope = {
      venueId: 'venue-1',
      userId: 'cook-1',
      role: 'cook',
      allAccess: false,
    } as any;

    const managerScope = {
      venueId: 'venue-1',
      userId: 'mgr-1',
      role: 'manager',
      allAccess: false,
    } as any;

    beforeEach(() => {
      mockPrisma.departmentMembership.findMany.mockImplementation(async ({ where }: any) => {
        if (where?.userId === 'cook-1') {
          return [
            {
              id: 'dm-cook',
              departmentId: 'dept-culinary',
              department: { code: 'CULINARY', name: 'Culinary' },
            },
          ];
        }
        return [];
      });
    });

    it('limits isolated culinary user to kitchen slice and strips other slices', async () => {
      mockPrisma.crmBeo.findMany.mockResolvedValue([
        {
          id: 'beo-1',
          eventName: 'Championship Game',
          serviceDate: '2026-09-15',
          serviceStartAt: new Date('2026-09-15T17:00:00Z'),
          serviceEndAt: new Date('2026-09-15T22:00:00Z'),
          loadInAt: null,
          loadOutAt: null,
          venueSpace: 'Main Concourse',
          spaceId: 'space-1',
          guestCount: 5000,
          status: 'confirmed',
          externalSource: 'generic-json',
          externalId: 'ext-1',
          eventId: 'evt-1',
          event: { title: 'Game Night' },
          suiteOrders: [{ id: 'so-1', beoNumber: 'SO-1', status: 'confirmed', guestCount: 20 }],
          departmentSlices: {
            kitchen: { menu: 'Burgers' },
            bars: { kegs: 10 },
            suites: { dessertCart: true },
          },
          layoutJson: null,
          updatedAt: new Date(),
        },
      ]);

      const res = await controller.listBeos(cookScope);
      expect(res.beos).toHaveLength(1);
      const b = res.beos[0];
      expect(b.departmentSlices).toEqual({ kitchen: { menu: 'Burgers' } });
      expect(b.suiteOrderCount).toBe(0);
    });

    it('throws 403 Forbidden if isolated user deep-filters a foreign department slice', async () => {
      await expect(
        controller.listBeos(cookScope, undefined, undefined, undefined, 'bars')
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 Forbidden if isolated user deep-links to a BEO with no matching department slice', async () => {
      mockPrisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-bar-only',
        venueId: 'venue-1',
        eventName: 'Bar Crawl',
        serviceDate: '2026-09-16',
        serviceStartAt: null,
        serviceEndAt: null,
        loadInAt: null,
        loadOutAt: null,
        venueSpace: 'Club Bar',
        spaceId: 'space-bar',
        guestCount: 50,
        status: 'confirmed',
        externalSource: 'manual',
        externalId: 'ext-bar',
        eventId: null,
        event: null,
        suiteOrders: [],
        departmentSlices: {
          bars: { signatureCocktails: ['Gin Fizz'] },
        },
        layoutJson: null,
        sourcePayload: null,
        sourceFileUrl: null,
        sourceUpdatedAt: null,
        specialRequirements: null,
        internalNotes: null,
        updatedAt: new Date(),
      });

      await expect(controller.getBeo(cookScope, 'beo-bar-only')).rejects.toThrow(ForbiddenException);
    });

    it('allows manager to see all slices across departments', async () => {
      mockPrisma.crmBeo.findMany.mockResolvedValue([
        {
          id: 'beo-1',
          eventName: 'Championship Game',
          serviceDate: '2026-09-15',
          serviceStartAt: new Date('2026-09-15T17:00:00Z'),
          serviceEndAt: new Date('2026-09-15T22:00:00Z'),
          loadInAt: null,
          loadOutAt: null,
          venueSpace: 'Main Concourse',
          spaceId: 'space-1',
          guestCount: 5000,
          status: 'confirmed',
          externalSource: 'generic-json',
          externalId: 'ext-1',
          eventId: 'evt-1',
          event: { title: 'Game Night' },
          suiteOrders: [{ id: 'so-1', beoNumber: 'SO-1', status: 'confirmed', guestCount: 20 }],
          departmentSlices: {
            kitchen: { menu: 'Burgers' },
            bars: { kegs: 10 },
          },
          layoutJson: null,
          updatedAt: new Date(),
        },
      ]);

      const res = await controller.listBeos(managerScope);
      expect(res.beos).toHaveLength(1);
      expect(res.beos[0].departmentSlices).toEqual({
        kitchen: { menu: 'Burgers' },
        bars: { kegs: 10 },
      });
      expect(res.beos[0].suiteOrderCount).toBe(1);
    });
  });
});
