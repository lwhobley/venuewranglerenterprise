CREATE TABLE tenant_setup_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  resource_type text NOT NULL CHECK (resource_type IN ('organization', 'venue', 'location', 'event')),
  resource_id uuid NOT NULL,
  event_id uuid,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_setup_audit_events_org_created_idx
  ON tenant_setup_audit_events (organization_id, created_at DESC, id DESC);

ALTER TABLE tenant_setup_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setup_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_setup_audit_events_tenant_select ON tenant_setup_audit_events
  FOR SELECT USING (organization_id = app_private.current_tenant_id());
CREATE POLICY tenant_setup_audit_events_tenant_insert ON tenant_setup_audit_events
  FOR INSERT WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND actor_id = app_private.current_actor_id()
  );

CREATE TRIGGER tenant_setup_audit_events_immutable
  BEFORE UPDATE OR DELETE ON tenant_setup_audit_events
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

GRANT SELECT, INSERT ON TABLE tenant_setup_audit_events TO venue_app;
