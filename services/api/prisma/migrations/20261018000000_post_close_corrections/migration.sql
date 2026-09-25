CREATE TABLE event_post_close_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('EVENT','ISSUE','TASK','ATTENDANCE','HOSPITALITY','STOCK_COUNT','STOCK_TRANSFER','VENDOR_REQUEST')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 80),
  headline text NOT NULL CHECK (length(headline) BETWEEN 1 AND 240),
  correction text NOT NULL CHECK (length(correction) BETWEEN 1 AND 4000),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_post_close_corrections_closeout_fk FOREIGN KEY(event_id, organization_id)
    REFERENCES event_closeouts(event_id, organization_id)
);
CREATE INDEX event_post_close_corrections_event_history_idx ON event_post_close_corrections(organization_id, event_id, created_at);
CREATE TRIGGER event_post_close_corrections_immutable BEFORE UPDATE OR DELETE ON event_post_close_corrections
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE event_post_close_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_post_close_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY event_post_close_corrections_tenant_scope ON event_post_close_corrections
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM event_closeouts c WHERE c.event_id = event_post_close_corrections.event_id
      AND c.organization_id = event_post_close_corrections.organization_id AND c.state = 'CLOSED'))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM event_closeouts c WHERE c.event_id = event_post_close_corrections.event_id
      AND c.organization_id = event_post_close_corrections.organization_id AND c.state = 'CLOSED'));
GRANT SELECT, INSERT ON event_post_close_corrections TO venue_app;
