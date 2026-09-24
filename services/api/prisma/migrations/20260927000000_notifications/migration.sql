CREATE OR REPLACE FUNCTION app_private.current_actor_id() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')
$$;
GRANT EXECUTE ON FUNCTION app_private.current_actor_id() TO venue_app;

CREATE TABLE user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES events(id),
  issue_id uuid REFERENCES issues(id),
  recipient_subject text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX user_notifications_organization_id_recipient_subject_read_at_created_at_idx
  ON user_notifications (organization_id, recipient_subject, read_at, created_at DESC);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY user_notifications_recipient_select ON user_notifications
  FOR SELECT
  USING (organization_id = app_private.current_tenant_id()
    AND recipient_subject = app_private.current_actor_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id)));
CREATE POLICY user_notifications_recipient_update ON user_notifications
  FOR UPDATE
  USING (organization_id = app_private.current_tenant_id()
    AND recipient_subject = app_private.current_actor_id())
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND recipient_subject = app_private.current_actor_id());
CREATE POLICY user_notifications_tenant_insert ON user_notifications
  FOR INSERT
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = user_notifications.event_id AND e.organization_id = user_notifications.organization_id)
    AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM issues i WHERE i.id = user_notifications.issue_id AND i.event_id = user_notifications.event_id)));

GRANT SELECT, INSERT, UPDATE ON TABLE user_notifications TO venue_app;
