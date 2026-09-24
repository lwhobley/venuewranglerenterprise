CREATE TYPE issue_state AS ENUM ('REPORTED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED', 'ESCALATED');
CREATE TYPE issue_severity AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  name text NOT NULL,
  starts_at timestamptz NOT NULL
);

CREATE TABLE issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES events(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  location_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  severity issue_severity NOT NULL,
  state issue_state NOT NULL DEFAULT 'REPORTED',
  reporter_id text NOT NULL,
  owner_id text,
  escalation_note text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  issue_id uuid NOT NULL REFERENCES issues(id),
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  action text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE INDEX issues_tenant_event_state_idx ON issues (organization_id, event_id, state);
CREATE INDEX issues_tenant_owner_idx ON issues (organization_id, owner_id);
CREATE INDEX issue_audit_tenant_issue_created_idx ON issue_audit_events (organization_id, issue_id, created_at);

CREATE OR REPLACE FUNCTION app_private.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_private.prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issue audit events are immutable';
END;
$$;

CREATE TRIGGER issue_audit_events_immutable
BEFORE UPDATE OR DELETE ON issue_audit_events
FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_scope ON organizations
  USING (id = app_private.current_tenant_id())
  WITH CHECK (id = app_private.current_tenant_id());
CREATE POLICY venues_tenant_scope ON venues
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE POLICY events_tenant_scope ON events
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE POLICY issues_tenant_scope ON issues
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE POLICY issue_audit_tenant_scope ON issue_audit_events
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE POLICY command_receipts_tenant_scope ON command_receipts
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());

GRANT USAGE ON SCHEMA app_private TO venue_app;
GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO venue_app;
ALTER DEFAULT PRIVILEGES FOR ROLE venue_migrator IN SCHEMA app_private
  GRANT EXECUTE ON FUNCTIONS TO venue_app;

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE venues FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;
ALTER TABLE issue_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE command_receipts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE _prisma_migrations FROM venue_app;
