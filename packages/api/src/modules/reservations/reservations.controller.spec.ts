import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, GoneException, UnauthorizedException } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { hashWebhookSecret } from '../../common/webhook-auth';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma = {
    reservationConnection: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    reservationSyncEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    reservation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    guest: { findFirst: vi.fn().mockResolvedValue(null) },
    reservationHold: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    floorPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    venue: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/New_York' }) },
    $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  } as any;
  const notifier = {
    sendConfirmation: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mutations = {
    saveReservation: vi.fn(),
    createHold: vi.fn(),
    deleteHold: vi.fn(),
    removeReservation: vi.fn(),
  } as any;
  const controller = new ReservationsController(prisma, notifier, mutations);
  return { controller, prisma, notifier, mutations };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

function makeRequest(ip = '203.0.113.5') {
  return { ip } as any;
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    externalEventId: 'evt-1',
    eventType: 'reservation.created',
    externalId: 'ext-1',
    guestName: 'Alex Guest',
    partySize: 4,
    reservationTime: Date.now(),
    eventTimestamp: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReservationsController', () => {
  describe('ingest webhook', () => {
    it('permanently rejects reservation sync with 410 Gone', async () => {
      const { controller } = makeController();
      await expect(
        controller.ingest(makeRequest(), 'venue-1', 'secret', { provider: 'opentable', events: [] } as any),
      ).rejects.toThrow(GoneException);
    });
  });

  describe('manager-only guard', () => {
    it('rejects staff from getReservationsPage', async () => {
      const { controller } = makeController();
      await expect(controller.getReservationsPage(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects an undefined scope from saveReservation', async () => {
      const { controller } = makeController();
      await expect(
        controller.saveReservation(undefined as any, { guestName: 'Alex', partySize: 2, reservationTime: '2026-07-20T18:00:00.000Z' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from getCoverPacing', async () => {
      const { controller } = makeController();
      await expect(controller.getCoverPacing(staffScope, '2026-07-20')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from guestAutofill', async () => {
      const { controller } = makeController();
      await expect(controller.guestAutofill(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from listHolds', async () => {
      const { controller } = makeController();
      await expect(controller.listHolds(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from createHold', async () => {
      const { controller } = makeController();
      await expect(
        controller.createHold(staffScope, { startsAt: '2026-07-20T18:00:00.000Z', endsAt: '2026-07-20T20:00:00.000Z', reason: 'private event' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from deleteHold', async () => {
      const { controller } = makeController();
      await expect(controller.deleteHold(staffScope, 'hold-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from removeReservation', async () => {
      const { controller } = makeController();
      await expect(controller.removeReservation(staffScope, 'res-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from exportReservationsCsv', async () => {
      const { controller } = makeController();
      await expect(controller.exportReservationsCsv(staffScope)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getReservationsPage', () => {
    it('scopes the query to the caller venue and returns mapped results', async () => {
      const { controller, prisma } = makeController();
      const reservationTime = new Date('2026-07-20T18:00:00.000Z');
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'res-1',
            venueId: 'venue-1',
            guestId: null,
            guestName: 'Alex Guest',
            partySize: 4,
            reservationTime,
            durationMinutes: 90,
            status: 'confirmed',
            source: 'direct',
            tags: [],
            guestCompany: null,
            occasion: null,
            notes: null,
            specialRequests: null,
            isPrivateEvent: false,
            eventName: null,
            eventStatus: null,
            eventSpace: null,
            setupStyle: null,
            menuNotes: null,
            beverageNotes: null,
            billingNotes: null,
            contractStatus: null,
            beoStatus: null,
            estimatedValueCents: null,
            depositDueCents: null,
            guestPhone: null,
            guestEmail: null,
            createdAt: reservationTime,
            updatedAt: reservationTime,
          },
        ],
        1,
      ]);

      const result = await controller.getReservationsPage(managerScope);

      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1', deletedAt: null }) }),
      );
      expect(prisma.reservation.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1', deletedAt: null }) }),
      );
      expect(result.totalCount).toBe(1);
      expect(result.reservations[0]).toEqual(expect.objectContaining({ id: 'res-1', guestName: 'Alex Guest' }));
    });

    it('rejects an invalid date filter', async () => {
      const { controller } = makeController();
      await expect(controller.getReservationsPage(managerScope, 'not-a-date')).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid status filter', async () => {
      const { controller } = makeController();
      await expect(controller.getReservationsPage(managerScope, undefined, 'bogus-status')).rejects.toThrow(BadRequestException);
    });
  });

  describe('saveReservation', () => {
    it('creates a reservation via the mutation service scoped to the venue', async () => {
      const { controller, mutations, notifier } = makeController();
      mutations.saveReservation.mockResolvedValue({
        reservation: { id: 'res-1', guestEmail: null, status: 'confirmed', confirmationSentAt: null },
        previousStatus: null,
      });

      const result = await controller.saveReservation(managerScope, {
        guestName: 'Alex Guest',
        partySize: 2,
        reservationTime: '2026-07-20T18:00:00.000Z',
      } as any);

      expect(mutations.saveReservation).toHaveBeenCalledWith(
        expect.objectContaining({ venueId: 'venue-1', guestName: 'Alex Guest', partySize: 2 }),
      );
      expect(result).toEqual({ id: 'res-1' });
      expect(notifier.sendConfirmation).not.toHaveBeenCalled();
    });

    it('sends a confirmation email on a new confirmed reservation with a guest email', async () => {
      const { controller, mutations, notifier } = makeController();
      mutations.saveReservation.mockResolvedValue({
        reservation: { id: 'res-1', guestEmail: 'guest@example.com', status: 'confirmed', confirmationSentAt: null },
        previousStatus: null,
      });

      await controller.saveReservation(managerScope, {
        guestName: 'Alex Guest',
        partySize: 2,
        reservationTime: '2026-07-20T18:00:00.000Z',
        email: 'guest@example.com',
      } as any);

      expect(notifier.sendConfirmation).toHaveBeenCalledWith('res-1');
    });

    it('does not resend a confirmation when an existing reservation was already confirmed', async () => {
      const { controller, mutations, notifier } = makeController();
      mutations.saveReservation.mockResolvedValue({
        reservation: { id: 'res-1', guestEmail: 'guest@example.com', status: 'confirmed', confirmationSentAt: null },
        previousStatus: 'confirmed',
      });

      await controller.saveReservation(managerScope, {
        reservationId: 'res-1',
        guestName: 'Alex Guest',
        partySize: 2,
        reservationTime: '2026-07-20T18:00:00.000Z',
        email: 'guest@example.com',
      } as any);

      expect(notifier.sendConfirmation).not.toHaveBeenCalled();
    });

    it('sends a confirmation when an existing reservation transitions into confirmed', async () => {
      const { controller, mutations, notifier } = makeController();
      mutations.saveReservation.mockResolvedValue({
        reservation: { id: 'res-1', guestEmail: 'guest@example.com', status: 'confirmed', confirmationSentAt: null },
        previousStatus: 'requested',
      });

      await controller.saveReservation(managerScope, {
        reservationId: 'res-1',
        guestName: 'Alex Guest',
        partySize: 2,
        reservationTime: '2026-07-20T18:00:00.000Z',
        email: 'guest@example.com',
        status: 'confirmed',
      } as any);

      expect(notifier.sendConfirmation).toHaveBeenCalledWith('res-1');
    });

    it('propagates a hold conflict raised by the mutation service', async () => {
      const { controller, mutations } = makeController();
      mutations.saveReservation.mockRejectedValue(new BadRequestException('This time conflicts with a hold: private event'));

      await expect(
        controller.saveReservation(managerScope, {
          guestName: 'Alex Guest',
          partySize: 2,
          reservationTime: '2026-07-20T18:00:00.000Z',
        } as any),
      ).rejects.toThrow('This time conflicts with a hold: private event');
    });
  });

  describe('removeReservation', () => {
    it('delegates to the mutation service scoped to the venue', async () => {
      const { controller, mutations } = makeController();
      mutations.removeReservation.mockResolvedValue(undefined);

      const result = await controller.removeReservation(managerScope, 'res-1');

      expect(mutations.removeReservation).toHaveBeenCalledWith({ venueId: 'venue-1', reservationId: 'res-1' });
      expect(result).toEqual({ ok: true });
    });

    it('propagates a not-found error for a reservation outside the venue', async () => {
      const { controller, mutations } = makeController();
      mutations.removeReservation.mockRejectedValue(new BadRequestException('Reservation not found'));

      await expect(controller.removeReservation(managerScope, 'other-venue-res')).rejects.toThrow('Reservation not found');
    });
  });

  describe('holds', () => {
    it('creates a hold via the mutation service scoped to the venue', async () => {
      const { controller, mutations } = makeController();
      mutations.createHold.mockResolvedValue({ id: 'hold-1' });

      const result = await controller.createHold(managerScope, {
        startsAt: '2026-07-20T18:00:00.000Z',
        endsAt: '2026-07-20T20:00:00.000Z',
        reason: 'private event',
      });

      expect(mutations.createHold).toHaveBeenCalledWith({
        venueId: 'venue-1',
        startsAt: '2026-07-20T18:00:00.000Z',
        endsAt: '2026-07-20T20:00:00.000Z',
        reason: 'private event',
      });
      expect(result).toEqual({ id: 'hold-1' });
    });

    it('deletes a hold scoped to the venue', async () => {
      const { controller, mutations } = makeController();
      mutations.deleteHold.mockResolvedValue(undefined);

      const result = await controller.deleteHold(managerScope, 'hold-1');

      expect(mutations.deleteHold).toHaveBeenCalledWith({ venueId: 'venue-1', holdId: 'hold-1' });
      expect(result).toEqual({ ok: true });
    });

    it('lists only holds ending in the future, ordered by start time', async () => {
      const { controller, prisma } = makeController();
      const startsAt = new Date('2026-07-21T18:00:00.000Z');
      const endsAt = new Date('2026-07-21T20:00:00.000Z');
      prisma.reservationHold.findMany.mockResolvedValue([{ id: 'hold-1', startsAt, endsAt, reason: 'private event' }]);

      const result = await controller.listHolds(managerScope);

      expect(prisma.reservationHold.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: 'venue-1', endsAt: { gte: expect.any(Date) } }),
          orderBy: { startsAt: 'asc' },
        }),
      );
      expect(result).toEqual([{ id: 'hold-1', startsAt: startsAt.getTime(), endsAt: endsAt.getTime(), reason: 'private event' }]);
    });
  });

  describe('guestAutofill', () => {
    it('returns null when neither email nor phone is provided', async () => {
      const { controller, prisma } = makeController();
      const result = await controller.guestAutofill(managerScope);
      expect(result).toEqual({ guest: null });
      expect(prisma.guest.findFirst).not.toHaveBeenCalled();
    });

    it('looks up a guest scoped to the venue by normalized email/phone', async () => {
      const { controller, prisma } = makeController();
      prisma.guest.findFirst.mockResolvedValue({
        id: 'guest-1',
        fullName: 'Alex Guest',
        email: 'alex@example.com',
        phone: '+15551234567',
        favoriteTable: null,
        preferredServer: null,
        dietaryNotes: null,
        tags: [],
        lifecycleStage: 'regular',
      });
      prisma.reservation.findFirst.mockResolvedValue(null);

      const result = await controller.guestAutofill(managerScope, 'Alex@Example.com');

      expect(prisma.guest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: 'venue-1', OR: [{ email: 'alex@example.com' }] }),
        }),
      );
      expect(result.guest).toEqual(expect.objectContaining({ id: 'guest-1', email: 'alex@example.com' }));
    });
  });

  describe('exportReservationsCsv', () => {
    it('produces CSV rows scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.reservation.findMany.mockResolvedValue([
        {
          guestName: 'Alex Guest',
          partySize: 2,
          reservationTime: new Date('2026-07-20T18:00:00.000Z'),
          status: 'confirmed',
          guestPhone: '555-1234',
          guestEmail: 'alex@example.com',
          notes: null,
        },
      ]);

      const csv = await controller.exportReservationsCsv(managerScope);

      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1', deletedAt: null }) }),
      );
      expect(csv).toContain('Alex Guest');
      expect(csv.split('\n')[0]).toBe('"Name","Party","Time","Status","Phone","Email","Notes"');
    });

    it('applies a bounded default window instead of the venue\'s entire history when no dates are supplied', async () => {
      const { controller, prisma } = makeController();
      prisma.reservation.findMany.mockResolvedValue([]);

      await controller.exportReservationsCsv(managerScope);

      const call = prisma.reservation.findMany.mock.calls[0][0];
      const timeFilter = call.where.reservationTime;
      expect(timeFilter.gte).toBeInstanceOf(Date);
      expect(timeFilter.lt).toBeInstanceOf(Date);
      expect(timeFilter.lt.getTime() - timeFilter.gte.getTime()).toBeLessThanOrEqual(181 * 24 * 60 * 60 * 1000);
    });

    it('leaves an explicit caller-supplied range uncapped', async () => {
      const { controller, prisma } = makeController();
      prisma.reservation.findMany.mockResolvedValue([]);

      await controller.exportReservationsCsv(managerScope, '2020-01-01', '2026-01-01');

      const call = prisma.reservation.findMany.mock.calls[0][0];
      expect(call.where.reservationTime.gte).toBeInstanceOf(Date);
      expect(call.where.reservationTime.lt).toBeInstanceOf(Date);
      expect(call.where.reservationTime.gte.getUTCFullYear()).toBe(2020);
    });
  });
});
