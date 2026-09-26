ALTER TABLE integration_identifiers ADD CONSTRAINT integration_identifiers_id_org_key UNIQUE (id, organization_id);

CREATE TABLE integration_identifier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  mapping_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action = 'corrected'),
  before_target_id uuid NOT NULL,
  after_target_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  observed_count integer NOT NULL CHECK (observed_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_identifier_audit_mapping_tenant_fk FOREIGN KEY (mapping_id, organization_id)
    REFERENCES integration_identifiers(id, organization_id)
);
CREATE INDEX integration_identifier_audit_mapping_idx ON integration_identifier_audit
  (organization_id, mapping_id, created_at DESC);

ALTER TABLE integration_identifier_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_identifier_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_identifier_audit_tenant_scope ON integration_identifier_audit
  FOR SELECT USING (organization_id = app_private.current_tenant_id());
CREATE POLICY integration_identifier_audit_tenant_insert ON integration_identifier_audit
  FOR INSERT WITH CHECK (organization_id = app_private.current_tenant_id() AND actor_id = app_private.current_actor_id());
CREATE TRIGGER integration_identifier_audit_immutable BEFORE UPDATE OR DELETE ON integration_identifier_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
GRANT SELECT, INSERT ON TABLE integration_identifier_audit TO venue_app;
