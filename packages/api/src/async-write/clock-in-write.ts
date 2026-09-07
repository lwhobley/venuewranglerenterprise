import { Prisma } from '@prisma/client';

/**
 * The domain half of a queued `clock_in` write.
 *
 * Extracted from worker.ts because that module boots a RabbitMQ consumer on
 * import and so cannot be exercised directly.
 */

/** What the clock-in route enqueues; every field is required by ClockInDto. */
export type ClockInPayload = {
  profileId: string;
  clockInAt: string | number | Date;
  lat: number;
  lng: number;
  accuracy: number;
  mocked: boolean;
};

type ClockInClient = Pick<Prisma.TransactionClient, 'timeEntry'>;

export type ClockInResult = {
  accepted: true;
  status: 'completed';
  timeEntryId: string;
  clockInAt: string;
};

/**
 * A partial unique index allows a single open TimeEntry per profile.
 * Conflict-safe insertion lets a duplicate complete against the existing punch
 * without aborting the transaction that also records the delivery receipt.
 */
export async function applyQueuedClockIn(
  tx: ClockInClient,
  venueId: string,
  payload: ClockInPayload,
): Promise<ClockInResult> {
  // ON CONFLICT DO NOTHING keeps the transaction usable on duplicate punches.
  await tx.timeEntry.createMany({
    data: [{
      profileId: payload.profileId,
      venueId,
      clockInAt: new Date(payload.clockInAt),
      clockInLat: payload.lat,
      clockInLng: payload.lng,
      clockInAccuracyM: payload.accuracy,
      clockInMocked: payload.mocked,
      isOpen: true,
    }],
    skipDuplicates: true,
  });
  const timeEntry = await tx.timeEntry.findFirst({
    where: { profileId: payload.profileId, venueId, isOpen: true },
    orderBy: { clockInAt: 'desc' },
    select: { id: true, clockInAt: true },
  });
  if (!timeEntry) throw new Error('No open punch found after queued clock-in.');

  return {
    accepted: true,
    status: 'completed',
    timeEntryId: timeEntry.id,
    clockInAt: timeEntry.clockInAt.toISOString(),
  };
}
