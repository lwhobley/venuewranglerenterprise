ALTER TABLE organizations ADD COLUMN slug text;
CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug);

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  external_subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_organization_id_external_subject_key UNIQUE (organization_id, external_subject),
  CONSTRAINT people_organization_id_email_key UNIQUE (organization_id, email)
);
CREATE INDEX people_organization_id_active_idx ON people (organization_id, active);

CREATE TYPE operational_task_kind AS ENUM ('PLAN', 'STAFFING', 'SERVICE', 'STOCK');
CREATE TYPE operational_task_state AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE');
ALTER TABLE locations ADD CONSTRAINT locations_id_venue_id_key UNIQUE (id, venue_id);

CREATE TABLE operational_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  event_id uuid NOT NULL REFERENCES events(id),
  location_id uuid,
  kind operational_task_kind NOT NULL,
  state operational_task_state NOT NULL DEFAULT 'OPEN',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id text,
  due_at timestamptz,
  expected_quantity numeric(12,3),
  actual_quantity numeric(12,3),
  unit text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_tasks_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT operational_task_location_venue_fk FOREIGN KEY (location_id, venue_id) REFERENCES locations(id, venue_id)
);
CREATE INDEX operational_tasks_organization_id_event_id_kind_state_idx ON operational_tasks (organization_id, event_id, kind, state);
CREATE INDEX operational_tasks_organization_id_owner_id_due_at_idx ON operational_tasks (organization_id, owner_id, due_at);

CREATE TABLE operational_task_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  task_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_task_audit_tenant_fk FOREIGN KEY (task_id, organization_id) REFERENCES operational_tasks(id, organization_id)
);
CREATE INDEX operational_task_audit_events_organization_id_task_id_created_at_idx ON operational_task_audit_events (organization_id, task_id, created_at);
CREATE TRIGGER operational_task_audit_events_immutable
BEFORE UPDATE OR DELETE ON operational_task_audit_events
FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_tenant_scope ON people
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());

ALTER TABLE operational_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY operational_tasks_tenant_scope ON operational_tasks
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = operational_tasks.event_id AND e.venue_id = operational_tasks.venue_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = operational_tasks.location_id AND l.venue_id = operational_tasks.venue_id)))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = operational_tasks.event_id AND e.venue_id = operational_tasks.venue_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = operational_tasks.location_id AND l.venue_id = operational_tasks.venue_id)));

ALTER TABLE operational_task_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_task_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY operational_task_audit_tenant_scope ON operational_task_audit_events
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM operational_tasks t WHERE t.id = operational_task_audit_events.task_id AND t.organization_id = operational_task_audit_events.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM operational_tasks t WHERE t.id = operational_task_audit_events.task_id AND t.organization_id = operational_task_audit_events.organization_id));

GRANT SELECT, INSERT, UPDATE ON TABLE people, operational_tasks TO venue_app;
GRANT SELECT, INSERT ON TABLE operational_task_audit_events TO venue_app;
