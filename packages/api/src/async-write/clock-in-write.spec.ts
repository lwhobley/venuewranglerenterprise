import { describe, expect, it, vi } from 'vitest';
import { applyQueuedClockIn } from './clock-in-write';

const CLOCK_IN_AT = new Date('2026-09-06T18:00:00.000Z');

function makeTx(overrides: Record<string, any> = {}) {
  return {
    timeEntry: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'entry-1', clockInAt: CLOCK_IN_AT }),
      ...overrides,
    },
  } as any;
}

const payload = {
  profileId: 'profile-1',
  clockInAt: CLOCK_IN_AT.toISOString(),
  lat: 40.7,
  lng: -74,
  accuracy: 8,
  mocked: false,
};

describe('applyQueuedClockIn', () => {
  it('creates the open punch and reports it', async () => {
    const tx = makeTx();

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).resolves.toEqual({
      accepted: true,
      status: 'completed',
      timeEntryId: 'entry-1',
      clockInAt: CLOCK_IN_AT.toISOString(),
    });
  });

  // Previously this P2002 escaped, isPermanent() classified the message as
  // poisoned, and a punch that had already landed was reported as a failure.
  it('completes against the existing punch when the worker races an open punch', async () => {
    const tx = makeTx({
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'entry-existing', clockInAt: CLOCK_IN_AT }),
    });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).resolves.toEqual({
      accepted: true,
      status: 'completed',
      timeEntryId: 'entry-existing',
      clockInAt: CLOCK_IN_AT.toISOString(),
    });
    expect(tx.timeEntry.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'profile-1', venueId: 'venue-1', isOpen: true },
      orderBy: { clockInAt: 'desc' },
      select: { id: true, clockInAt: true },
    });
    expect(tx.timeEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('rethrows a uniqueness failure that left no open punch to complete against', async () => {
    const tx = makeTx({ createMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValue(null) });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).rejects.toThrow('No open punch found');
  });

  it('rethrows errors that are not uniqueness failures', async () => {
    const tx = makeTx({ createMany: vi.fn().mockRejectedValue(new Error('connection lost')) });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).rejects.toThrow('connection lost');
    expect(tx.timeEntry.findFirst).not.toHaveBeenCalled();
  });
});
