CREATE TABLE staff_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subject text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_unavailability_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT staff_unavailability_time_order CHECK (ends_at > starts_at),
  CONSTRAINT staff_unavailability_active_person_fk FOREIGN KEY (organization_id, subject)
    REFERENCES people(organization_id, external_subject) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX staff_unavailability_subject_time_idx ON staff_unavailability (organization_id, subject, starts_at, ends_at);

CREATE TABLE staff_unavailability_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unavailability_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_unavailability_audit_tenant_fk FOREIGN KEY (unavailability_id, organization_id)
    REFERENCES staff_unavailability(id, organization_id)
);
CREATE INDEX staff_unavailability_audit_time_idx ON staff_unavailability_audit (organization_id, unavailability_id, created_at);
CREATE TRIGGER staff_unavailability_audit_immutable BEFORE UPDATE OR DELETE ON staff_unavailability_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staff_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_unavailability FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_unavailability_tenant_scope ON staff_unavailability
  FOR SELECT
  USING (organization_id = app_private.current_tenant_id())
  ;
CREATE POLICY staff_unavailability_owner_insert ON staff_unavailability
  FOR INSERT WITH CHECK (organization_id = app_private.current_tenant_id() AND subject = app_private.current_actor_id());
CREATE POLICY staff_unavailability_owner_mutation ON staff_unavailability
  FOR UPDATE USING (organization_id = app_private.current_tenant_id() AND subject = app_private.current_actor_id())
  WITH CHECK (organization_id = app_private.current_tenant_id() AND subject = app_private.current_actor_id());
CREATE POLICY staff_unavailability_owner_delete ON staff_unavailability
  FOR DELETE USING (organization_id = app_private.current_tenant_id() AND subject = app_private.current_actor_id());

ALTER TABLE staff_unavailability_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_unavailability_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_unavailability_audit_tenant_scope ON staff_unavailability_audit
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id() AND actor_id = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM staff_unavailability u WHERE u.id = staff_unavailability_audit.unavailability_id AND u.organization_id = staff_unavailability_audit.organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_unavailability TO venue_app;
GRANT SELECT, INSERT ON staff_unavailability_audit TO venue_app;
