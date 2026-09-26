CREATE TABLE venue_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_departments_venue_fk FOREIGN KEY (venue_id, organization_id)
    REFERENCES venues(id, organization_id),
  CONSTRAINT venue_departments_code_key UNIQUE (organization_id, venue_id, code),
  CONSTRAINT venue_departments_scope_key UNIQUE (id, venue_id, organization_id)
);

CREATE TABLE venue_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  department_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_service_areas_venue_fk FOREIGN KEY (venue_id, organization_id)
    REFERENCES venues(id, organization_id),
  CONSTRAINT venue_service_areas_department_fk FOREIGN KEY (department_id, venue_id, organization_id)
    REFERENCES venue_departments(id, venue_id, organization_id),
  CONSTRAINT venue_service_areas_code_key UNIQUE (organization_id, venue_id, code),
  CONSTRAINT venue_service_areas_scope_key UNIQUE (id, venue_id, organization_id)
);

ALTER TABLE locations ADD COLUMN service_area_id uuid;
ALTER TABLE locations ADD CONSTRAINT locations_service_area_scope_fk
  FOREIGN KEY (service_area_id, venue_id, organization_id)
  REFERENCES venue_service_areas(id, venue_id, organization_id);
CREATE INDEX locations_service_area_idx ON locations (organization_id, venue_id, service_area_id);

ALTER TABLE venue_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_departments FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_departments_tenant_scope ON venue_departments
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT ON TABLE venue_departments TO venue_app;

ALTER TABLE venue_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_service_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_service_areas_tenant_scope ON venue_service_areas
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT ON TABLE venue_service_areas TO venue_app;

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification', 'staffing_policy', 'department', 'service_area'));
