import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { HealthController } from '../src/health.controller';
import type { PrismaService } from '../src/prisma.service';

function responseDouble() {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return response;
}

function controllerFor(role: { rolsuper: boolean; rolbypassrls: boolean }, tables: {
  protected: boolean;
  table_count: bigint;
  policy_table_count: bigint;
}) {
  const prisma = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([role])
      .mockResolvedValueOnce([tables]),
  } as unknown as PrismaService;
  return new HealthController(prisma);
}

describe('API health RLS gate', () => {
  it('reports healthy only when the runtime role and all protected tables enforce RLS', async () => {
    const response = responseDouble();
    const controller = controllerFor(
      { rolsuper: false, rolbypassrls: false },
      { protected: true, table_count: 17n, policy_table_count: 17n },
    );

    await controller.check(response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      rlsEnforced: true,
      databaseConnected: true,
    }));
  });

  it.each([
    ['a superuser runtime role', { rolsuper: true, rolbypassrls: false }, { protected: true, table_count: 17n, policy_table_count: 17n }],
    ['a BYPASSRLS runtime role', { rolsuper: false, rolbypassrls: true }, { protected: true, table_count: 17n, policy_table_count: 17n }],
    ['an unprotected application table', { rolsuper: false, rolbypassrls: false }, { protected: false, table_count: 17n, policy_table_count: 17n }],
    ['a missing protected table', { rolsuper: false, rolbypassrls: false }, { protected: true, table_count: 16n, policy_table_count: 16n }],
  ] as const)('fails closed for %s', async (_name, role, tables) => {
    const response = responseDouble();
    const controller = controllerFor(role, tables);

    await controller.check(response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      rlsEnforced: false,
    }));
  });
});
