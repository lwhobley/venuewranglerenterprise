CREATE TABLE venue_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  structure jsonb NOT NULL CHECK (jsonb_typeof(structure) = 'object' AND octet_length(structure::text) <= 65536),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_templates_version_key UNIQUE (organization_id, code, version)
);
CREATE INDEX venue_templates_code_latest_idx ON venue_templates (organization_id, code, version DESC);

ALTER TABLE venue_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_templates_tenant_scope ON venue_templates
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE TRIGGER venue_templates_immutable BEFORE UPDATE OR DELETE ON venue_templates
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
GRANT SELECT, INSERT ON TABLE venue_templates TO venue_app;

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification', 'staffing_policy', 'department', 'service_area', 'venue_template'));
