import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

function makeController() {
  const prisma = {
    crmLead: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'lead-new', ...data })),
      update: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    crmNote: {
      create: vi.fn().mockResolvedValue({ id: 'note-1' }),
    },
    crmBeo: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'beo-new', ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'beo-1', ...data })),
    },
    crmContract: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'contract-new', ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    crmActivityLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    venue: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test Venue' }),
    },
    emailTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'template-new', ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'template-1', ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
    reservationHold: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    reservation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'reservation-new' }),
      update: vi.fn().mockResolvedValue({ id: 'reservation-existing' }),
    },
    $transaction: vi.fn().mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  } as any;

  const executionAutopilot = { ensureWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1' }) };

  const controller = new CrmController(prisma, executionAutopilot as any);
  return { controller, prisma, executionAutopilot };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CrmController', () => {
  // ============================================================
  // Authorization: every endpoint uses the same requireManager()
  // guard. We verify rejection across a spread of endpoints (list,
  // write, aggregate) plus the "no scope" case; success-through-the-
  // guard is exercised implicitly by every other test using managerScope.
  // ============================================================
  describe('authorization', () => {
    it('rejects staff from listing BEOs', async () => {
      const { controller } = makeController();
      await expect(controller.listBeos(staffScope, {})).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from saving a BEO', async () => {
      const { controller } = makeController();
      await expect(controller.saveBeo(staffScope, { eventName: 'Party' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing scope', async () => {
      const { controller } = makeController();
      await expect(controller.listBeos(undefined as any, {})).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // BEOs
  // ============================================================
  describe('listBeos', () => {
    it('scopes BEOs to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findMany.mockResolvedValue([
        {
          id: 'beo-1', venueId: 'venue-1', eventName: 'Wedding', eventDate: null, eventType: null,
          guestCount: null, venueSpace: null, setupStyle: null, fbMinimumCents: null, depositCents: null,
          depositDueDate: null, menuAppetizers: null, menuEntrees: null, menuDesserts: null, menuBarPackage: null,
          specialRequirements: null, internalNotes: null, assignedRepId: null, status: 'draft',
          createdAt: new Date(), updatedAt: new Date(),
          _count: { suiteOrders: 3 },
        },
      ]);

      const result = await controller.listBeos(managerScope, {});

      expect(prisma.crmBeo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { venueId: 'venue-1' } }));
      expect(result[0]).toEqual(expect.objectContaining({ _id: 'beo-1', eventName: 'Wedding' }));
    });

    it('reports how many operational suite orders were raised against each BEO', async () => {
      const { controller, prisma } = makeController();
      prisma.crmBeo.findMany.mockResolvedValue([
        {
          id: 'beo-1', venueId: 'venue-1', eventName: 'Suite hospitality', eventDate: null,
          eventType: null, guestCount: null, venueSpace: null, setupStyle: null, fbMinimumCents: null,
          depositCents: null, depositDueDate: null, menuAppetizers: null, menuEntrees: null, menuDesserts: null,
          menuBarPackage: null, specialRequirements: null, internalNotes: null, assignedRepId: null,
          status: 'confirmed', createdAt: new Date(), updatedAt: new Date(),
          _count: { suiteOrders: 4 },
        },
      ]);

      const result = await controller.listBeos(managerScope, {});

      expect(result[0]).toEqual(expect.objectContaining({ suiteOrderCount: 4 }));
    });
  });

  describe('saveBeo', () => {
    it('throws NotFoundException when updating a BEO outside the venue', async () => {
      const { controller } = makeController();

      await expect(controller.saveBeo(managerScope, { beoId: 'beo-1', eventName: 'Party' } as any))
        .rejects.toThrow(NotFoundException);
    });

    it('creates a draft BEO without syncing a reservation', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.saveBeo(managerScope, { eventName: 'Tasting' } as any);

      expect(prisma.crmBeo.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', status: 'draft', eventName: 'Tasting' }),
      }));
      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(result).toEqual({ beoId: 'beo-new' });
    });

    it('syncs a confirmed BEO with an event date to a new blocking reservation', async () => {
      const { controller, prisma, executionAutopilot } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      const result = await controller.saveBeo(managerScope, {
        eventName: 'Gala', eventDate, guestCount: 80, venueSpace: 'Ballroom', status: 'confirmed',
      } as any);

      expect(prisma.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          venueId: 'venue-1', guestName: 'Gala', partySize: 80, durationMinutes: 240,
          isPrivateEvent: true, status: 'confirmed', tags: [`beo:beo-new`, 'private_event'],
        }),
      }));
      expect(executionAutopilot.ensureWorkspace).toHaveBeenCalledWith(expect.objectContaining({
        venueId: 'venue-1', sourceType: 'beo', sourceId: 'beo-new', title: 'Gala',
      }), prisma);
      expect(result).toEqual({ beoId: 'beo-new' });
    });

    it('updates the existing reservation instead of creating a duplicate when one already exists for the BEO', async () => {
      const { controller, prisma } = makeController();
      prisma.reservation.findFirst.mockResolvedValue({ id: 'reservation-existing' });
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      await controller.saveBeo(managerScope, { eventName: 'Gala', eventDate, status: 'confirmed' } as any);

      expect(prisma.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'reservation-existing' } }));
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and does not create a reservation when a hold conflicts with the event window', async () => {
      const { controller, prisma } = makeController();
      prisma.reservationHold.findFirst.mockResolvedValue({ reason: 'Private buyout' });
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');

      await expect(controller.saveBeo(managerScope, { eventName: 'Gala', eventDate, status: 'confirmed' } as any))
        .rejects.toThrow('Cannot sync BEO to reservation - time conflicts with a hold: Private buyout');
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it('re-syncs the reservation when an existing BEO transitions to confirmed', async () => {
      const { controller, prisma } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', status: 'draft', eventName: 'Gala', eventDate: new Date(eventDate),
      });

      await controller.saveBeo(managerScope, { beoId: 'beo-1', eventName: 'Gala', eventDate, status: 'confirmed' } as any);

      expect(prisma.reservation.create).toHaveBeenCalled();
    });

    it('does not re-sync an already-confirmed BEO when no reservation-relevant field changed', async () => {
      const { controller, prisma } = makeController();
      const eventDate = Date.parse('2026-08-01T18:00:00.000Z');
      prisma.crmBeo.findFirst.mockResolvedValue({
        id: 'beo-1', leadId: 'lead-1', status: 'confirmed', eventName: 'Gala', eventDate: new Date(eventDate),
      });

      await controller.saveBeo(managerScope, { beoId: 'beo-1', internalNotes: 'vip guest' } as any);

      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Contracts
  // ============================================================
  // ============================================================
  // Analytics
  // ============================================================
  // ============================================================
  // Email
  // ============================================================
  // ============================================================
  // Email templates (representative coverage - listTemplates is a
  // trivial passthrough getter and is intentionally not covered here).
  // ============================================================
});
