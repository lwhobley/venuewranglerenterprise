import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res() response: Response) {
    try {
      const [role] = await this.prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user
      `;
      const [tables] = await this.prisma.$queryRaw<Array<{ protected: boolean; table_count: bigint; policy_table_count: bigint }>>`
        SELECT count(*) > 0
                 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (
                   SELECT 1 FROM pg_policies p
                   WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                 )) AS protected,
               count(*) AS table_count,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = n.nspname AND p.tablename = c.relname
               )) AS policy_table_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> '_prisma_migrations'
      `;
      const rlsEnforced = role !== undefined && !role.rolsuper && !role.rolbypassrls && tables?.protected === true && tables.table_count > 0n && tables.policy_table_count === tables.table_count;
      const body = { ok: rlsEnforced, rlsEnforced, databaseConnected: true, runtimeRole: role ? { superuser: role.rolsuper, bypassRls: role.rolbypassrls } : null };
      return response.status(rlsEnforced ? 200 : 503).json(body);
    } catch {
      return response.status(503).json({ ok: false, rlsEnforced: false, databaseConnected: false });
    }
  }
}
