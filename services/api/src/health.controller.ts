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
        SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS protected,
               count(*) AS table_count,
               (SELECT count(DISTINCT p.tablename) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN (
                 'organizations','venues','events','locations','issues','issue_audit_events','command_receipts','issue_events',
                 'people','person_audit_events','operational_tasks','operational_task_audit_events','user_notifications','issue_attachments','external_integration_events','push_devices','tenant_setup_audit_events','staff_shifts','staff_shift_audit_events','staff_unavailability','staff_unavailability_audit','person_qualifications','staff_breaks','staff_attendance_claims','staffing_demands','staffing_demand_audit',
                 'stock_items','stock_counts','stock_count_lines','stock_movements','stock_count_audit','hospitality_orders','hospitality_order_lines','hospitality_order_fulfillments','hospitality_order_audit','stock_transfers','stock_transfer_lines','stock_transfer_audit',
                 'event_closeouts','event_closeout_followups','event_closeout_audit','staffing_vendor_requests','staffing_vendor_request_audit','event_post_close_corrections'
               )) AS policy_table_count
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN (
          'organizations','venues','events','locations','issues','issue_audit_events','command_receipts','issue_events',
          'people','person_audit_events','operational_tasks','operational_task_audit_events','user_notifications','issue_attachments','external_integration_events','push_devices','tenant_setup_audit_events','staff_shifts','staff_shift_audit_events','staff_unavailability','staff_unavailability_audit','person_qualifications','staff_breaks','staff_attendance_claims','staffing_demands','staffing_demand_audit',
          'stock_items','stock_counts','stock_count_lines','stock_movements','stock_count_audit','hospitality_orders','hospitality_order_lines','hospitality_order_fulfillments','hospitality_order_audit','stock_transfers','stock_transfer_lines','stock_transfer_audit',
          'event_closeouts','event_closeout_followups','event_closeout_audit','staffing_vendor_requests','staffing_vendor_request_audit','event_post_close_corrections'
        )
      `;
      const rlsEnforced = role !== undefined && !role.rolsuper && !role.rolbypassrls && tables?.protected === true && tables.table_count === 44n && tables.policy_table_count === 44n;
      const body = { ok: rlsEnforced, rlsEnforced, databaseConnected: true, runtimeRole: role ? { superuser: role.rolsuper, bypassRls: role.rolbypassrls } : null };
      return response.status(rlsEnforced ? 200 : 503).json(body);
    } catch {
      return response.status(503).json({ ok: false, rlsEnforced: false, databaseConnected: false });
    }
  }
}
