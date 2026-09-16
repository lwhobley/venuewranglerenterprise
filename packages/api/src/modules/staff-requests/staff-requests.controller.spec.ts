import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffRequestsController } from './staff-requests.controller';

describe('StaffRequestsController', () => {
  it('scopes a staff member to only their own venue requests', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new StaffRequestsController({ staffRequest: { findMany } } as any, {} as any, {} as any);

    await expect(controller.listStaffRequests({
      venueId: 'venue-1',
      profileId: 'profile-1',
      role: 'staff',
    } as any)).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { venueId: 'venue-1', profileId: 'profile-1' },
    }));
  });

  it('returns no data without venue scope and rejects mutations', async () => {
    const controller = new StaffRequestsController({} as any, {} as any, {} as any);
    await expect(controller.listStaffRequests(undefined)).resolves.toEqual([]);
    await expect(controller.createStaffRequest(undefined, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
