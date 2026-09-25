ALTER TABLE staff_shifts
  ADD COLUMN required_qualification_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE TABLE person_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  person_id uuid NOT NULL,
  qualification_code text NOT NULL CHECK (qualification_code ~ '^[A-Z0-9][A-Z0-9._-]{1,39}$'),
  qualification_name text NOT NULL CHECK (length(qualification_name) BETWEEN 2 AND 120),
  expires_at date,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_qualifications_person_tenant_fk FOREIGN KEY (person_id, organization_id)
    REFERENCES people(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT person_qualifications_org_person_code_key UNIQUE (organization_id, person_id, qualification_code),
  CONSTRAINT person_qualifications_id_organization_key UNIQUE (id, organization_id)
);
CREATE INDEX person_qualifications_active_lookup_idx
  ON person_qualifications (organization_id, person_id, revoked_at, expires_at);

ALTER TABLE person_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY person_qualifications_tenant_select ON person_qualifications
  FOR SELECT USING (organization_id = app_private.current_tenant_id());
CREATE POLICY person_qualifications_tenant_insert ON person_qualifications
  FOR INSERT WITH CHECK (organization_id = app_private.current_tenant_id()
    AND created_by = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM people p WHERE p.id = person_qualifications.person_id
      AND p.organization_id = person_qualifications.organization_id));
CREATE POLICY person_qualifications_tenant_update ON person_qualifications
  FOR UPDATE USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON person_qualifications TO venue_app;

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification'));
