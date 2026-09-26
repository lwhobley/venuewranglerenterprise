CREATE TABLE integration_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind text NOT NULL CHECK (kind IN ('VENUE', 'EVENT', 'LOCATION')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 240),
  internal_id uuid NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_identifiers_source_key UNIQUE (organization_id, source, kind, external_id)
);
CREATE INDEX integration_identifiers_target_idx ON integration_identifiers
  (organization_id, source, kind, internal_id);

ALTER TABLE integration_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_identifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_identifiers_tenant_scope ON integration_identifiers
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON TABLE integration_identifiers TO venue_app;
