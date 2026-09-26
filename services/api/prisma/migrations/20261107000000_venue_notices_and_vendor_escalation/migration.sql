CREATE TABLE venue_notice_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  subject text NOT NULL,
  assigned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_notice_recipients_venue_tenant_fk FOREIGN KEY (venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT venue_notice_recipients_person_fk FOREIGN KEY (organization_id, subject) REFERENCES people(organization_id, external_subject),
  CONSTRAINT venue_notice_recipients_unique UNIQUE (organization_id, venue_id, subject)
);

CREATE TABLE venue_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  recipient_subject text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('venue.activated', 'vendor.deadline_escalated')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT venue_notices_venue_tenant_fk FOREIGN KEY (venue_id, organization_id) REFERENCES venues(id, organization_id)
);
CREATE INDEX venue_notices_recipient_idx ON venue_notices (organization_id, recipient_subject, read_at, created_at DESC);

ALTER TABLE staffing_vendor_requests ADD COLUMN escalated_at timestamptz;

ALTER TABLE venue_notice_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_notice_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_notice_recipients_tenant_scope ON venue_notice_recipients
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE venue_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_notices_recipient_select ON venue_notices FOR SELECT
  USING (organization_id = app_private.current_tenant_id() AND recipient_subject = app_private.current_actor_id());
CREATE POLICY venue_notices_recipient_update ON venue_notices FOR UPDATE
  USING (organization_id = app_private.current_tenant_id() AND recipient_subject = app_private.current_actor_id())
  WITH CHECK (organization_id = app_private.current_tenant_id() AND recipient_subject = app_private.current_actor_id());
CREATE POLICY venue_notices_tenant_insert ON venue_notices FOR INSERT
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, DELETE ON TABLE venue_notice_recipients TO venue_app;
GRANT SELECT, INSERT, UPDATE ON TABLE venue_notices TO venue_app;

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification', 'staffing_policy', 'department', 'service_area', 'venue_template', 'integration_ownership', 'venue_notice_recipient'));
