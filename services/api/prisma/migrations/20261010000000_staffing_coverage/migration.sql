CREATE TABLE staffing_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  event_id uuid NOT NULL REFERENCES events(id),
  location_id uuid,
  role text NOT NULL CHECK (length(btrim(role)) BETWEEN 2 AND 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  required_headcount integer NOT NULL CHECK (required_headcount BETWEEN 1 AND 500),
  required_qualification_codes text[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staffing_demands_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT staffing_demands_time_order CHECK (ends_at > starts_at),
  CONSTRAINT staffing_demands_location_venue_fk FOREIGN KEY (location_id, venue_id) REFERENCES locations(id, venue_id)
);
CREATE INDEX staffing_demands_org_event_starts_idx ON staffing_demands(organization_id, event_id, starts_at);
ALTER TABLE staff_shifts ADD COLUMN staffing_demand_id uuid;
ALTER TABLE staff_shifts ADD CONSTRAINT staff_shifts_demand_tenant_fk
  FOREIGN KEY (staffing_demand_id, organization_id) REFERENCES staffing_demands(id, organization_id);

CREATE TABLE staffing_demand_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  demand_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staffing_demand_audit_tenant_fk FOREIGN KEY (demand_id, organization_id) REFERENCES staffing_demands(id, organization_id)
);
CREATE INDEX staffing_demand_audit_org_demand_created_idx ON staffing_demand_audit(organization_id, demand_id, created_at);
CREATE TRIGGER staffing_demand_audit_immutable
  BEFORE UPDATE OR DELETE ON staffing_demand_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staffing_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_demands FORCE ROW LEVEL SECURITY;
CREATE POLICY staffing_demands_tenant_scope ON staffing_demands
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staffing_demands.event_id AND e.venue_id = staffing_demands.venue_id AND e.organization_id = staffing_demands.organization_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = staffing_demands.location_id AND l.venue_id = staffing_demands.venue_id AND l.organization_id = staffing_demands.organization_id)))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staffing_demands.event_id AND e.venue_id = staffing_demands.venue_id AND e.organization_id = staffing_demands.organization_id)
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM locations l WHERE l.id = staffing_demands.location_id AND l.venue_id = staffing_demands.venue_id AND l.organization_id = staffing_demands.organization_id)));

ALTER TABLE staffing_demand_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_demand_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY staffing_demand_audit_tenant_scope ON staffing_demand_audit
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staffing_demands d WHERE d.id = staffing_demand_audit.demand_id AND d.organization_id = staffing_demand_audit.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staffing_demands d WHERE d.id = staffing_demand_audit.demand_id AND d.organization_id = staffing_demand_audit.organization_id));

GRANT SELECT, INSERT, UPDATE ON staffing_demands TO venue_app;
GRANT SELECT, INSERT ON staffing_demand_audit TO venue_app;
