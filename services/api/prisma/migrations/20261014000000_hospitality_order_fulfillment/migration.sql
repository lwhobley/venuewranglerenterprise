CREATE TYPE hospitality_order_state AS ENUM ('SUBMITTED','ACCEPTED','PREPARING','READY','DISTRIBUTED','PICKED_UP','REJECTED','CANCELLED');

CREATE TABLE hospitality_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  location_id uuid,
  requested_by text NOT NULL,
  assigned_to text,
  service_at timestamptz NOT NULL,
  instructions text NOT NULL DEFAULT '',
  state hospitality_order_state NOT NULL DEFAULT 'SUBMITTED',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_orders_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT hospitality_orders_venue_tenant_fk FOREIGN KEY(venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT hospitality_orders_event_tenant_fk FOREIGN KEY(event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT hospitality_orders_location_tenant_fk FOREIGN KEY(location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id),
  CONSTRAINT hospitality_orders_instructions_length CHECK (length(instructions) <= 1000),
  CONSTRAINT hospitality_orders_rejection_reason_length CHECK (rejection_reason IS NULL OR length(rejection_reason) BETWEEN 3 AND 500)
);
CREATE INDEX hospitality_orders_queue_idx ON hospitality_orders(organization_id, event_id, state, service_at);
CREATE INDEX hospitality_orders_assignee_idx ON hospitality_orders(organization_id, assigned_to, state, service_at);

CREATE TABLE hospitality_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid NOT NULL,
  item_name text NOT NULL CHECK (length(btrim(item_name)) BETWEEN 2 AND 160),
  quantity numeric(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 24),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  CONSTRAINT hospitality_order_lines_order_tenant_fk FOREIGN KEY(order_id, organization_id) REFERENCES hospitality_orders(id, organization_id)
);
CREATE INDEX hospitality_order_lines_order_idx ON hospitality_order_lines(organization_id, order_id);

CREATE TABLE hospitality_order_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_order_audit_order_tenant_fk FOREIGN KEY(order_id, organization_id) REFERENCES hospitality_orders(id, organization_id)
);
CREATE INDEX hospitality_order_audit_order_idx ON hospitality_order_audit(organization_id, order_id, created_at);
CREATE TRIGGER hospitality_order_audit_immutable BEFORE UPDATE OR DELETE ON hospitality_order_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE hospitality_orders ADD CONSTRAINT hospitality_orders_id_event_org_key UNIQUE(id, event_id, organization_id);
ALTER TABLE user_notifications ADD COLUMN hospitality_order_id uuid;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_hospitality_order_tenant_fk
  FOREIGN KEY(hospitality_order_id, event_id, organization_id) REFERENCES hospitality_orders(id, event_id, organization_id);
CREATE INDEX user_notifications_hospitality_order_idx ON user_notifications(organization_id, hospitality_order_id) WHERE hospitality_order_id IS NOT NULL;

DROP POLICY user_notifications_recipient_select ON user_notifications;
CREATE POLICY user_notifications_recipient_select ON user_notifications FOR SELECT
  USING (organization_id = app_private.current_tenant_id()
    AND recipient_subject = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id))
    AND (shift_id IS NULL OR EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = user_notifications.shift_id AND s.event_id = user_notifications.event_id AND s.organization_id = user_notifications.organization_id))
    AND (hospitality_order_id IS NULL OR EXISTS (SELECT 1 FROM hospitality_orders o WHERE o.id = user_notifications.hospitality_order_id AND o.event_id = user_notifications.event_id AND o.organization_id = user_notifications.organization_id)));
DROP POLICY user_notifications_tenant_insert ON user_notifications;
CREATE POLICY user_notifications_tenant_insert ON user_notifications FOR INSERT
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id))
    AND (shift_id IS NULL OR EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = user_notifications.shift_id AND s.event_id = user_notifications.event_id AND s.organization_id = user_notifications.organization_id))
    AND (hospitality_order_id IS NULL OR EXISTS (SELECT 1 FROM hospitality_orders o WHERE o.id = user_notifications.hospitality_order_id AND o.event_id = user_notifications.event_id AND o.organization_id = user_notifications.organization_id)));

ALTER TABLE hospitality_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_orders_tenant_scope ON hospitality_orders
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE hospitality_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_order_lines_tenant_scope ON hospitality_order_lines
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE hospitality_order_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_order_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_order_audit_tenant_scope ON hospitality_order_audit
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON hospitality_orders TO venue_app;
GRANT SELECT, INSERT ON hospitality_order_lines, hospitality_order_audit TO venue_app;
