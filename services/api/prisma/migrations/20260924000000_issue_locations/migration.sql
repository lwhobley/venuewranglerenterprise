CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  name text NOT NULL
);

CREATE INDEX locations_tenant_venue_idx ON locations (organization_id, venue_id);
ALTER TABLE issues ADD CONSTRAINT issues_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant_scope ON locations
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());

DROP POLICY issues_tenant_scope ON issues;
CREATE POLICY issues_tenant_scope ON issues
  USING (organization_id = app_private.current_tenant_id()
    AND (location_id IS NULL OR EXISTS (
      SELECT 1 FROM locations l
      WHERE l.id = issues.location_id AND l.venue_id = issues.venue_id
    )))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND (location_id IS NULL OR EXISTS (
      SELECT 1 FROM locations l
      WHERE l.id = issues.location_id AND l.venue_id = issues.venue_id
    )));
