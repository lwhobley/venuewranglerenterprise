CREATE TABLE integration_field_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  domain text NOT NULL CHECK (domain IN ('LABOR', 'POS', 'TICKETING', 'INVENTORY', 'EVENT')),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_field_ownership_domain_key UNIQUE (organization_id, domain)
);

ALTER TABLE integration_field_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_field_ownership FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_field_ownership_tenant_scope ON integration_field_ownership
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON TABLE integration_field_ownership TO venue_app;

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification', 'staffing_policy', 'department', 'service_area', 'venue_template', 'integration_ownership'));
