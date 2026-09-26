CREATE TABLE integration_source_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  cursor text NOT NULL DEFAULT '' CHECK (length(cursor) <= 500),
  last_status text NOT NULL DEFAULT 'NEVER' CHECK (last_status IN ('NEVER', 'OK', 'FAILED', 'RATE_LIMITED')),
  last_error text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 1000),
  last_polled_at timestamptz,
  next_poll_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_source_checkpoints_source_key UNIQUE (organization_id, source)
);

CREATE TABLE integration_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 240),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536),
  error text NOT NULL CHECK (length(error) BETWEEN 1 AND 500),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 8),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'REPLAYED', 'EXHAUSTED')),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_dead_letters_source_external_key UNIQUE (organization_id, source, external_id)
);
CREATE INDEX integration_dead_letters_review_idx ON integration_dead_letters (organization_id, source, state, next_attempt_at);

ALTER TABLE integration_source_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_source_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_source_checkpoints_tenant_scope ON integration_source_checkpoints
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE integration_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_dead_letters FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_dead_letters_tenant_scope ON integration_dead_letters
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON TABLE integration_source_checkpoints, integration_dead_letters TO venue_app;
