CREATE TABLE support_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  operator_subject text NOT NULL CHECK (length(operator_subject) BETWEEN 3 AND 1024),
  operator_tenant_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_access_sessions_venue_fk FOREIGN KEY (venue_id, organization_id)
    REFERENCES venues(id, organization_id),
  CONSTRAINT support_access_sessions_scope_key UNIQUE (id, organization_id)
);
CREATE INDEX support_access_sessions_venue_expiry_idx ON support_access_sessions (organization_id, venue_id, expires_at);

CREATE TABLE support_access_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id uuid NOT NULL,
  method text NOT NULL CHECK (method ~ '^[A-Z]{3,10}$'),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_access_activity_session_fk FOREIGN KEY (session_id, organization_id)
    REFERENCES support_access_sessions(id, organization_id)
);
CREATE INDEX support_access_activity_session_created_idx ON support_access_activity (organization_id, session_id, created_at);
CREATE TRIGGER support_access_activity_immutable BEFORE UPDATE OR DELETE ON support_access_activity
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE support_access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY support_access_sessions_tenant_scope ON support_access_sessions
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE support_access_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY support_access_activity_tenant_scope ON support_access_activity
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON TABLE support_access_sessions TO venue_app;
GRANT SELECT, INSERT ON TABLE support_access_activity TO venue_app;
