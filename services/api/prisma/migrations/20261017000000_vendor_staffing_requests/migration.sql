CREATE TYPE vendor_staffing_request_state AS ENUM
  ('SENT','ACKNOWLEDGED','PARTIALLY_COMMITTED','COMMITTED','DECLINED','CANCELLED','FULFILLED');

ALTER TABLE staffing_demands
  ADD CONSTRAINT staffing_demands_id_event_organization_key UNIQUE(id, event_id, organization_id);

CREATE TABLE staffing_vendor_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  location_id uuid,
  demand_id uuid NOT NULL,
  requester_subject text NOT NULL,
  vendor_subject text NOT NULL,
  requested_headcount smallint NOT NULL CHECK (requested_headcount BETWEEN 1 AND 500),
  committed_headcount smallint NOT NULL DEFAULT 0 CHECK (committed_headcount BETWEEN 0 AND requested_headcount),
  response_due_at timestamptz NOT NULL,
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 1000),
  state vendor_staffing_request_state NOT NULL DEFAULT 'SENT',
  response_reason text NOT NULL DEFAULT '' CHECK (length(response_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT staffing_vendor_requests_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT staffing_vendor_requests_id_event_org_key UNIQUE(id, event_id, organization_id),
  CONSTRAINT staffing_vendor_requests_venue_tenant_fk FOREIGN KEY(venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT staffing_vendor_requests_event_scope_fk FOREIGN KEY(event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT staffing_vendor_requests_location_scope_fk FOREIGN KEY(location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id),
  CONSTRAINT staffing_vendor_requests_demand_scope_fk FOREIGN KEY(demand_id, event_id, organization_id) REFERENCES staffing_demands(id, event_id, organization_id),
  CONSTRAINT staffing_vendor_requests_vendor_fk FOREIGN KEY(organization_id, vendor_subject) REFERENCES people(organization_id, external_subject),
  CONSTRAINT staffing_vendor_requests_resolution_check CHECK
    ((state = 'FULFILLED' AND fulfilled_at IS NOT NULL) OR state <> 'FULFILLED'),
  CONSTRAINT staffing_vendor_requests_cancel_check CHECK
    ((state = 'CANCELLED' AND cancelled_at IS NOT NULL) OR state <> 'CANCELLED')
);
CREATE INDEX staffing_vendor_requests_event_state_due_idx ON staffing_vendor_requests(organization_id, event_id, state, response_due_at);
CREATE INDEX staffing_vendor_requests_vendor_state_due_idx ON staffing_vendor_requests(organization_id, vendor_subject, state, response_due_at);
CREATE INDEX staffing_vendor_requests_demand_idx ON staffing_vendor_requests(organization_id, demand_id, state);

CREATE TABLE staffing_vendor_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  request_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staffing_vendor_request_audit_request_tenant_fk FOREIGN KEY(request_id, organization_id) REFERENCES staffing_vendor_requests(id, organization_id)
);
CREATE INDEX staffing_vendor_request_audit_history_idx ON staffing_vendor_request_audit(organization_id, request_id, created_at);
CREATE TRIGGER staffing_vendor_request_audit_immutable BEFORE UPDATE OR DELETE ON staffing_vendor_request_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staffing_vendor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_vendor_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY staffing_vendor_requests_tenant_scope ON staffing_vendor_requests
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staffing_vendor_requests.event_id AND e.venue_id = staffing_vendor_requests.venue_id AND e.organization_id = staffing_vendor_requests.organization_id)
    AND EXISTS (SELECT 1 FROM staffing_demands d WHERE d.id = staffing_vendor_requests.demand_id AND d.event_id = staffing_vendor_requests.event_id AND d.organization_id = staffing_vendor_requests.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = staffing_vendor_requests.event_id AND e.venue_id = staffing_vendor_requests.venue_id AND e.organization_id = staffing_vendor_requests.organization_id)
    AND EXISTS (SELECT 1 FROM staffing_demands d WHERE d.id = staffing_vendor_requests.demand_id AND d.event_id = staffing_vendor_requests.event_id AND d.organization_id = staffing_vendor_requests.organization_id));

ALTER TABLE staffing_vendor_request_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_vendor_request_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY staffing_vendor_request_audit_tenant_scope ON staffing_vendor_request_audit
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staffing_vendor_requests r WHERE r.id = staffing_vendor_request_audit.request_id AND r.organization_id = staffing_vendor_request_audit.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staffing_vendor_requests r WHERE r.id = staffing_vendor_request_audit.request_id AND r.organization_id = staffing_vendor_request_audit.organization_id));

GRANT SELECT, INSERT, UPDATE ON staffing_vendor_requests TO venue_app;
GRANT SELECT, INSERT ON staffing_vendor_request_audit TO venue_app;

CREATE TRIGGER staffing_vendor_requests_open_event_required BEFORE INSERT OR UPDATE OR DELETE ON staffing_vendor_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();

ALTER TABLE event_closeout_followups DROP CONSTRAINT event_closeout_followups_source_type_check;
ALTER TABLE event_closeout_followups ADD CONSTRAINT event_closeout_followups_source_type_check
  CHECK (source_type IN ('ISSUE','TASK','ATTENDANCE','HOSPITALITY','STOCK_COUNT','STOCK_TRANSFER','VENDOR_REQUEST'));
