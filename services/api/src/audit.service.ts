import { BadRequestException, Injectable } from '@nestjs/common';
import { assertTenantAdmin, Identity } from './auth';
import { PrismaService } from './prisma.service';

const defaultLimit = 50;
const maxLimit = 100;

type AuditRow = {
  id: string;
  actorId: string;
  action: string;
  resourceType: 'issue' | 'task' | 'person' | 'organization' | 'venue' | 'location' | 'event' | 'qualification' | 'staffing_policy' | 'event_closeout';
  resourceId: string;
  eventId: string | null;
  changedFields: string[] | null;
  createdAt: string;
};

type RawAuditRow = {
  id: string;
  actor_id: string;
  action: string;
  resource_type: AuditRow['resourceType'];
  resource_id: string;
  event_id: string | null;
  changed_fields: string[] | null;
  created_at: string;
};

type AuditCursor = { createdAt: string; id: string };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: Identity, rawLimit?: string, rawCursor?: string) {
    assertTenantAdmin(identity);
    const limit = this.parseLimit(rawLimit);
    const cursor = this.parseCursor(rawCursor);
    return this.prisma.withTenant(identity, async (tx) => {
      const raw = await tx.$queryRaw<RawAuditRow[]>`
        WITH audit_rows AS (
          SELECT audit.id, audit.actor_id, audit.action,
                 'issue'::text AS resource_type, audit.issue_id AS resource_id,
                 issue.event_id, NULL::text[] AS changed_fields, audit.created_at
          FROM issue_audit_events AS audit
          JOIN issues AS issue
            ON issue.id = audit.issue_id
           AND issue.organization_id = audit.organization_id
          WHERE audit.organization_id = ${identity.tenantId}::uuid
          UNION ALL
          SELECT audit.id, audit.actor_id, audit.action, 'task'::text,
                 audit.task_id, task.event_id, NULL::text[], audit.created_at
          FROM operational_task_audit_events AS audit
          JOIN operational_tasks AS task
            ON task.id = audit.task_id
           AND task.organization_id = audit.organization_id
          WHERE audit.organization_id = ${identity.tenantId}::uuid
          UNION ALL
          SELECT id, actor_id, action, 'person'::text, person_id,
                 NULL::uuid, changed_fields, created_at
          FROM person_audit_events
          WHERE organization_id = ${identity.tenantId}::uuid
          UNION ALL
          SELECT id, actor_id, action, resource_type, resource_id,
                 event_id, changed_fields, created_at
          FROM tenant_setup_audit_events
          WHERE organization_id = ${identity.tenantId}::uuid
          UNION ALL
          SELECT audit.id, audit.actor_id, audit.action, 'event_closeout'::text,
                 audit.closeout_id, closeout.event_id, NULL::text[], audit.created_at
          FROM event_closeout_audit AS audit
          JOIN event_closeouts AS closeout
            ON closeout.id = audit.closeout_id
           AND closeout.organization_id = audit.organization_id
          WHERE audit.organization_id = ${identity.tenantId}::uuid
        )
        SELECT id::text AS id, actor_id, action, resource_type, resource_id::text,
               event_id::text, changed_fields,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM audit_rows
        WHERE ${cursor?.createdAt ?? null}::timestamptz IS NULL
           OR (created_at, id) < (
                ${cursor?.createdAt ?? null}::timestamptz,
                ${cursor?.id ?? null}::uuid
              )
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
      const combined: AuditRow[] = raw.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        eventId: row.event_id,
        changedFields: row.changed_fields,
        createdAt: row.created_at,
      }));
      const page = combined.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor:
          raw.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  createdAt: last.createdAt,
                  id: last.id,
                }),
              ).toString('base64url')
            : null,
      };
    });
  }

  private parseLimit(raw?: string) {
    if (raw === undefined) return defaultLimit;
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('Audit limit must be a positive integer.');
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maxLimit) {
      throw new BadRequestException(`Audit limit must be between 1 and ${maxLimit}.`);
    }
    return value;
  }

  private parseCursor(raw?: string): AuditCursor | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
        createdAt?: unknown;
        id?: unknown;
      };
      const createdAt =
        typeof value.createdAt === 'string' ? new Date(value.createdAt) : null;
      if (
        !createdAt ||
        !Number.isFinite(createdAt.getTime()) ||
        typeof value.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      ) {
        throw new Error('Malformed cursor');
      }
      return { createdAt: value.createdAt as string, id: value.id };
    } catch {
      throw new BadRequestException('Audit cursor is invalid.');
    }
  }
}
