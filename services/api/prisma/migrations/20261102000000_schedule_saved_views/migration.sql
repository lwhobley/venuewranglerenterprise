CREATE TABLE schedule_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  owner_subject text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  shared boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object' AND octet_length(filters::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_saved_views_venue_fk FOREIGN KEY (venue_id, organization_id)
    REFERENCES venues(id, organization_id),
  CONSTRAINT schedule_saved_views_owner_name_key UNIQUE (organization_id, venue_id, owner_subject, name)
);
CREATE INDEX schedule_saved_views_venue_shared_idx ON schedule_saved_views (organization_id, venue_id, shared);
ALTER TABLE schedule_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY schedule_saved_views_tenant_scope ON schedule_saved_views
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, DELETE ON TABLE schedule_saved_views TO venue_app;
