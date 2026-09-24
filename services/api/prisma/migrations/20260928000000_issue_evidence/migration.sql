CREATE TYPE attachment_status AS ENUM ('PENDING_UPLOAD', 'READY');

CREATE TABLE issue_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES events(id),
  issue_id uuid NOT NULL REFERENCES issues(id),
  client_id uuid NOT NULL,
  uploaded_by text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_key text NOT NULL UNIQUE,
  status attachment_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  CONSTRAINT issue_attachments_issue_client_key UNIQUE (issue_id, client_id)
);
CREATE INDEX issue_attachments_organization_id_event_id_issue_id_created_at_idx
  ON issue_attachments (organization_id, event_id, issue_id, created_at);

ALTER TABLE issue_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_attachments_read_tenant ON issue_attachments
  FOR SELECT
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_attachments.issue_id AND i.event_id = issue_attachments.event_id AND i.organization_id = issue_attachments.organization_id));
CREATE POLICY issue_attachments_insert_actor ON issue_attachments
  FOR INSERT
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM issues i WHERE i.id = issue_attachments.issue_id AND i.event_id = issue_attachments.event_id AND i.organization_id = issue_attachments.organization_id));
CREATE POLICY issue_attachments_update_actor ON issue_attachments
  FOR UPDATE
  USING (organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id())
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id());

GRANT SELECT, INSERT, UPDATE ON TABLE issue_attachments TO venue_app;
