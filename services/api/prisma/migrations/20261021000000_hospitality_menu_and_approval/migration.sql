ALTER TYPE hospitality_order_state ADD VALUE 'AWAITING_APPROVAL';

ALTER TABLE organizations
  ADD COLUMN hospitality_approval_threshold numeric(10,3)
  CHECK (hospitality_approval_threshold IS NULL OR hospitality_approval_threshold >= 0);

ALTER TABLE hospitality_orders
  ADD COLUMN beo_reference text;

ALTER TABLE hospitality_orders
  ADD CONSTRAINT hospitality_orders_beo_reference_length
  CHECK (beo_reference IS NULL OR length(btrim(beo_reference)) BETWEEN 1 AND 120);

CREATE TABLE hospitality_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  category text NOT NULL DEFAULT 'General' CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  unit text NOT NULL DEFAULT 'each' CHECK (length(btrim(unit)) BETWEEN 1 AND 24),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_menu_items_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT hospitality_menu_items_venue_org_fk FOREIGN KEY(venue_id, organization_id) REFERENCES venues(id, organization_id)
);

CREATE INDEX hospitality_menu_items_scope_idx ON hospitality_menu_items(organization_id, venue_id, active, category, name);
CREATE UNIQUE INDEX hospitality_menu_items_venue_name_unique ON hospitality_menu_items(organization_id, venue_id, lower(name));

ALTER TABLE hospitality_order_lines
  ADD COLUMN menu_item_id uuid,
  ADD CONSTRAINT hospitality_order_lines_menu_item_fk
    FOREIGN KEY (menu_item_id, organization_id)
    REFERENCES hospitality_menu_items(id, organization_id);

ALTER TABLE hospitality_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_menu_items FORCE ROW LEVEL SECURITY;

CREATE POLICY hospitality_menu_items_tenant_scope ON hospitality_menu_items
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM venues v
      WHERE v.id = hospitality_menu_items.venue_id
        AND v.organization_id = hospitality_menu_items.organization_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON hospitality_menu_items TO venue_app;
