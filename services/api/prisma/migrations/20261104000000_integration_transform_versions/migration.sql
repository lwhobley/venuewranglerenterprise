CREATE TABLE integration_transform_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 8192),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_transform_versions_source_version_key UNIQUE (organization_id, source, version)
);
CREATE INDEX integration_transform_versions_source_latest_idx ON integration_transform_versions
  (organization_id, source, version DESC);

ALTER TABLE integration_transform_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_transform_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_transform_versions_tenant_scope ON integration_transform_versions
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
CREATE TRIGGER integration_transform_versions_immutable BEFORE UPDATE OR DELETE ON integration_transform_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
GRANT SELECT, INSERT ON TABLE integration_transform_versions TO venue_app;
