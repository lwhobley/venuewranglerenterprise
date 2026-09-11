import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkforceController } from './workforce.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkforceController invite check email', () => {
  // Outer-level mocks: leftover invite/profile lookups (phone-only no longer
  // hits the database). Email minting happens inside the transaction.
  const outerFindInvite = vi.fn();
  const outerFindProfile = vi.fn();
  // Inner (tx-scoped) mocks: everything the email path does happens inside
  // the advisory-locked transaction.
  const txFindInvite = vi.fn();
  const txCreateInvite = vi.fn();
  const txFindProfile = vi.fn();
  const executeLock = vi.fn();
  const sendOrThrow = vi.fn().mockResolvedValue(undefined);

  const prisma = {
    invite: { findFirst: outerFindInvite },
    profile: { findFirst: outerFindProfile },
    $transaction: vi.fn((callback: any) => callback({
      $executeRaw: executeLock,
      invite: { findFirst: txFindInvite, create: txCreateInvite },
      profile: { findFirst: txFindProfile },
    })),
  };
  const email = { sendOrThrow };
  const config = {
    get: vi.fn((key: string) => key === 'APP_WEB_URL' ? 'https://app.example.com/' : undefined),
  };
  const request = { ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
    sendOrThrow.mockResolvedValue(undefined);
  });

  it('keeps an existing redeemable invite valid without sending another email', async () => {
    txFindInvite.mockResolvedValue({
      id: 'invite-1',
      email: 'staff@example.com',
      usedBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      jobTitle: 'Server',
      venue: { name: 'Test Venue' },
    });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: ' Staff@Example.com ' }))
      .resolves.toEqual({ status: 'ok' });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });

  it('mints an invite token for a legacy unclaimed roster profile', async () => {
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    txCreateInvite.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'invite-2',
      usedBy: null,
      venue: { name: 'Legacy Venue' },
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'ok' });
    expect(txCreateInvite).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        venueId: 'venue-1',
        email: 'legacy@example.com',
        role: 'staff',
        jobTitle: 'Bartender',
        tokenHash: expect.any(String),
      }),
    }));
    expect(sendOrThrow).toHaveBeenCalledOnce();
    expect(executeLock).toHaveBeenCalledOnce();
  });

  it('does not rotate an already-created invite on a later check', async () => {
    // A repeated lookup must leave the original emailed credential intact.
    txFindInvite.mockResolvedValue({
      id: 'invite-2',
      email: 'legacy@example.com',
      usedBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'ok' });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });

  it('mints a fresh invite for an unclaimed roster profile even when a used invite exists for the email', async () => {
    // The redeemable-only tx lookup finds nothing (the only invite on file
    // is already used), so it must fall through to the roster/mint branch
    // instead of reporting "used" and stranding a legitimate roster row.
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    txCreateInvite.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'invite-3',
      usedBy: null,
      venue: { name: 'Legacy Venue' },
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'ok' });
    expect(txCreateInvite).toHaveBeenCalledOnce();
  });

  it('returns the same opaque status when there is no roster fallback', async () => {
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue(null);
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'gone@example.com' }))
      .resolves.toEqual({ status: 'ok' });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });

  it('returns the same opaque status for phone-only checks without looking up the roster', async () => {
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { phone: '555-0100' }))
      .resolves.toEqual({ status: 'ok' });
    expect(outerFindInvite).not.toHaveBeenCalled();
    expect(outerFindProfile).not.toHaveBeenCalled();
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });
});

describe('WorkforceController venue search', () => {
  const findMany = vi.fn();
  const prisma = {
    venue: { findMany },
  };
  const request = { ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects array-shaped query parameters instead of throwing a 500', async () => {
    const controller = new WorkforceController(prisma as any, {} as any, {} as any);

    await expect(controller.searchVenues(request as any, ['venue']))
      .rejects.toThrow('Search query must be a string.');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects excessively long search terms', async () => {
    const controller = new WorkforceController(prisma as any, {} as any, {} as any);

    await expect(controller.searchVenues(request as any, 'a'.repeat(121)))
      .rejects.toThrow('Search query must be 120 characters or fewer.');
    expect(findMany).not.toHaveBeenCalled();
  });
});
