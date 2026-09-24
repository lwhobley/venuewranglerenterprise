CREATE TABLE push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 320),
  installation_id uuid NOT NULL,
  registration_token text NOT NULL CHECK (length(registration_token) BETWEEN 32 AND 4096),
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_devices_organization_installation_key UNIQUE (organization_id, installation_id),
  CONSTRAINT push_devices_organization_token_sha256_key UNIQUE (organization_id, token_sha256)
);
CREATE INDEX push_devices_organization_subject_active_idx
  ON push_devices (organization_id, subject, active);

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY push_devices_owner_scope ON push_devices
  USING (organization_id = app_private.current_tenant_id()
    AND subject = app_private.current_actor_id())
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND subject = app_private.current_actor_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_devices TO venue_app;
