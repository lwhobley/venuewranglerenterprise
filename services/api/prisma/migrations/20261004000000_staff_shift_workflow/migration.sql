CREATE TYPE staff_shift_state AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
CREATE TYPE staff_shift_response AS ENUM ('PENDING', 'ACKNOWLEDGED', 'DECLINED');
CREATE TYPE staff_attendance_state AS ENUM ('NOT_STARTED', 'CHECKED_IN', 'CHECKED_OUT');

CREATE TABLE staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  event_id uuid NOT NULL REFERENCES events(id),
  location_id uuid,
  assigned_subject text,
  role text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state staff_shift_state NOT NULL DEFAULT 'DRAFT',
  response staff_shift_response NOT NULL DEFAULT 'PENDING',
  attendance staff_attendance_state NOT NULL DEFAULT 'NOT_STARTED',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  response_revision integer,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shifts_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT staff_shifts_id_event_organization_key UNIQUE (id, event_id, organization_id),
  CONSTRAINT staff_shifts_time_order CHECK (ends_at > starts_at),
  CONSTRAINT staff_shifts_response_revision CHECK (response_revision IS NULL OR response_revision <= revision),
  CONSTRAINT staff_shifts_attendance_timestamps CHECK (
    (attendance = 'NOT_STARTED' AND checked_in_at IS NULL AND checked_out_at IS NULL)
    OR (attendance = 'CHECKED_IN' AND checked_in_at IS NOT NULL AND checked_out_at IS NULL)
    OR (attendance = 'CHECKED_OUT' AND checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL AND checked_out_at >= checked_in_at)
  ),
  CONSTRAINT staff_shifts_location_venue_fk FOREIGN KEY (location_id, venue_id) REFERENCES locations(id, venue_id)
);
CREATE INDEX staff_shifts_organization_id_event_id_state_starts_at_idx
  ON staff_shifts (organization_id, event_id, state, starts_at);
CREATE INDEX staff_shifts_organization_id_assigned_subject_starts_at_idx
  ON staff_shifts (organization_id, assigned_subject, starts_at);

CREATE TABLE staff_shift_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  shift_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shift_audit_tenant_fk FOREIGN KEY (shift_id, organization_id) REFERENCES staff_shifts(id, organization_id)
);
CREATE INDEX staff_shift_audit_events_organization_id_shift_id_created_at_idx
  ON staff_shift_audit_events (organization_id, shift_id, created_at);
CREATE TRIGGER staff_shift_audit_events_immutable
  BEFORE UPDATE OR DELETE ON staff_shift_audit_events
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_shifts_tenant_scope ON staff_shifts
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staff_shifts.event_id AND e.venue_id = staff_shifts.venue_id AND e.organization_id = staff_shifts.organization_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = staff_shifts.location_id AND l.venue_id = staff_shifts.venue_id AND l.organization_id = staff_shifts.organization_id)))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staff_shifts.event_id AND e.venue_id = staff_shifts.venue_id AND e.organization_id = staff_shifts.organization_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = staff_shifts.location_id AND l.venue_id = staff_shifts.venue_id AND l.organization_id = staff_shifts.organization_id)));

ALTER TABLE staff_shift_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shift_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_shift_audit_events_tenant_scope ON staff_shift_audit_events
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_shift_audit_events.shift_id AND s.organization_id = staff_shift_audit_events.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_shift_audit_events.shift_id AND s.organization_id = staff_shift_audit_events.organization_id));

GRANT SELECT, INSERT, UPDATE ON TABLE staff_shifts TO venue_app;
GRANT SELECT, INSERT ON TABLE staff_shift_audit_events TO venue_app;

ALTER TABLE user_notifications ADD COLUMN shift_id uuid;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_shift_event_tenant_fk
  FOREIGN KEY (shift_id, event_id, organization_id) REFERENCES staff_shifts(id, event_id, organization_id);

DROP POLICY user_notifications_recipient_select ON user_notifications;
CREATE POLICY user_notifications_recipient_select ON user_notifications
  FOR SELECT
  USING (organization_id = app_private.current_tenant_id()
    AND recipient_subject = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id))
    AND (shift_id IS NULL OR EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = user_notifications.shift_id AND s.event_id = user_notifications.event_id AND s.organization_id = user_notifications.organization_id)));
DROP POLICY user_notifications_tenant_insert ON user_notifications;
CREATE POLICY user_notifications_tenant_insert ON user_notifications
  FOR INSERT
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id))
    AND (shift_id IS NULL OR EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = user_notifications.shift_id AND s.event_id = user_notifications.event_id AND s.organization_id = user_notifications.organization_id)));
