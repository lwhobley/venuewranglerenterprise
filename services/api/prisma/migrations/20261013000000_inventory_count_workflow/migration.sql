ALTER TABLE venues ADD CONSTRAINT venues_id_organization_unique UNIQUE(id, organization_id);
ALTER TABLE events ADD CONSTRAINT events_id_venue_org_unique UNIQUE(id, venue_id, organization_id);
ALTER TABLE locations ADD CONSTRAINT locations_id_venue_org_unique UNIQUE(id, venue_id, organization_id);

CREATE TABLE stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  location_id uuid,
  sku text NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 24),
  on_hand numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_items_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT stock_items_sku_location_key UNIQUE(organization_id, venue_id, location_id, sku),
  CONSTRAINT stock_items_venue_org_fk FOREIGN KEY(venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT stock_items_location_venue_org_fk FOREIGN KEY(location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id)
);
CREATE INDEX stock_items_scope_idx ON stock_items(organization_id, venue_id, location_id, active, name);
CREATE UNIQUE INDEX stock_items_sku_scope_unique ON stock_items(organization_id, venue_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(sku));

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  location_id uuid,
  state text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS','SUBMITTED','APPROVED','CANCELLED')),
  counter_id text NOT NULL,
  reviewer_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  CONSTRAINT stock_counts_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT stock_counts_event_venue_org_fk FOREIGN KEY(event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT stock_counts_location_venue_org_fk FOREIGN KEY(location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id)
);
CREATE INDEX stock_counts_scope_idx ON stock_counts(organization_id, event_id, state, created_at DESC);

CREATE TABLE stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  count_id uuid NOT NULL,
  item_id uuid NOT NULL,
  expected_quantity numeric(12,3) NOT NULL CHECK (expected_quantity >= 0),
  counted_quantity numeric(12,3) CHECK (counted_quantity >= 0),
  note text,
  counted_at timestamptz,
  CONSTRAINT stock_count_lines_count_item_key UNIQUE(count_id, item_id),
  CONSTRAINT stock_count_lines_count_org_fk FOREIGN KEY(count_id, organization_id) REFERENCES stock_counts(id, organization_id),
  CONSTRAINT stock_count_lines_item_org_fk FOREIGN KEY(item_id, organization_id) REFERENCES stock_items(id, organization_id)
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  item_id uuid NOT NULL,
  count_id uuid,
  actor_id text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('COUNT_ADJUSTMENT')),
  quantity_delta numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_item_org_fk FOREIGN KEY(item_id, organization_id) REFERENCES stock_items(id, organization_id),
  CONSTRAINT stock_movements_count_org_fk FOREIGN KEY(count_id, organization_id) REFERENCES stock_counts(id, organization_id)
);
CREATE INDEX stock_movements_item_idx ON stock_movements(organization_id, item_id, created_at DESC);

CREATE TABLE stock_count_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  count_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_audit_count_org_fk FOREIGN KEY(count_id, organization_id) REFERENCES stock_counts(id, organization_id)
);
CREATE INDEX stock_count_audit_count_idx ON stock_count_audit(organization_id, count_id, created_at);
CREATE TRIGGER stock_count_audit_immutable BEFORE UPDATE OR DELETE ON stock_count_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['stock_items','stock_counts','stock_count_lines','stock_movements','stock_count_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = app_private.current_tenant_id()) WITH CHECK (organization_id = app_private.current_tenant_id())', tbl || '_tenant_scope', tbl);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON stock_items, stock_counts, stock_count_lines TO venue_app;
GRANT SELECT, INSERT ON stock_movements, stock_count_audit TO venue_app;
