CREATE TABLE external_integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES events(id),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 240),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_integration_events_org_source_external_key UNIQUE (organization_id, source, external_id)
);
CREATE INDEX external_integration_events_org_event_occurred_idx
  ON external_integration_events (organization_id, event_id, occurred_at DESC);

ALTER TABLE external_integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_integration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY external_integration_events_tenant_scope ON external_integration_events
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = external_integration_events.event_id AND e.organization_id = external_integration_events.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = external_integration_events.event_id AND e.organization_id = external_integration_events.organization_id));
GRANT SELECT, INSERT ON TABLE external_integration_events TO venue_app;
