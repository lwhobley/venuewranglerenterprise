ALTER TABLE hospitality_menu_items
  ADD CONSTRAINT hospitality_menu_items_id_venue_org_key
  UNIQUE (id, venue_id, organization_id);

ALTER TABLE hospitality_order_fulfillments
  ADD CONSTRAINT hospitality_order_fulfillments_id_org_key
  UNIQUE (id, organization_id);

ALTER TABLE stock_movements
  ADD COLUMN hospitality_order_id uuid,
  ADD COLUMN hospitality_fulfillment_id uuid;

ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('COUNT_ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','PURCHASE_RECEIPT','HOSPITALITY_CONSUMPTION')),
  ADD CONSTRAINT stock_movements_hospitality_order_org_fk
    FOREIGN KEY (hospitality_order_id, organization_id)
    REFERENCES hospitality_orders(id, organization_id),
  ADD CONSTRAINT stock_movements_hospitality_fulfillment_org_fk
    FOREIGN KEY (hospitality_fulfillment_id, organization_id)
    REFERENCES hospitality_order_fulfillments(id, organization_id),
  ADD CONSTRAINT stock_movements_hospitality_references_check
    CHECK (
      (movement_type = 'HOSPITALITY_CONSUMPTION'
        AND hospitality_order_id IS NOT NULL AND hospitality_fulfillment_id IS NOT NULL)
      OR
      (movement_type <> 'HOSPITALITY_CONSUMPTION'
        AND hospitality_order_id IS NULL AND hospitality_fulfillment_id IS NULL)
    );

CREATE UNIQUE INDEX stock_movements_hospitality_fulfillment_item_key
  ON stock_movements(organization_id, hospitality_fulfillment_id, item_id)
  WHERE hospitality_fulfillment_id IS NOT NULL;

CREATE TABLE hospitality_menu_recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  stock_item_id uuid NOT NULL,
  quantity_per_menu_unit numeric(12,6) NOT NULL CHECK (quantity_per_menu_unit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_menu_recipe_lines_menu_item_key
    UNIQUE (organization_id, menu_item_id, stock_item_id),
  CONSTRAINT hospitality_menu_recipe_lines_id_org_key
    UNIQUE (id, organization_id),
  CONSTRAINT hospitality_menu_recipe_lines_venue_org_fk
    FOREIGN KEY (venue_id, organization_id)
    REFERENCES venues(id, organization_id),
  CONSTRAINT hospitality_menu_recipe_lines_menu_scope_fk
    FOREIGN KEY (menu_item_id, venue_id, organization_id)
    REFERENCES hospitality_menu_items(id, venue_id, organization_id),
  CONSTRAINT hospitality_menu_recipe_lines_stock_scope_fk
    FOREIGN KEY (stock_item_id, venue_id, organization_id)
    REFERENCES stock_items(id, venue_id, organization_id)
);
CREATE INDEX hospitality_menu_recipe_lines_menu_idx
  ON hospitality_menu_recipe_lines(organization_id, venue_id, menu_item_id);
CREATE INDEX hospitality_menu_recipe_lines_stock_idx
  ON hospitality_menu_recipe_lines(organization_id, stock_item_id);

ALTER TABLE hospitality_menu_recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_menu_recipe_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_menu_recipe_lines_tenant_scope
  ON hospitality_menu_recipe_lines
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM hospitality_menu_items m
      WHERE m.id = hospitality_menu_recipe_lines.menu_item_id
        AND m.venue_id = hospitality_menu_recipe_lines.venue_id
        AND m.organization_id = hospitality_menu_recipe_lines.organization_id
    )
    AND EXISTS (
      SELECT 1 FROM stock_items s
      WHERE s.id = hospitality_menu_recipe_lines.stock_item_id
        AND s.venue_id = hospitality_menu_recipe_lines.venue_id
        AND s.organization_id = hospitality_menu_recipe_lines.organization_id
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON hospitality_menu_recipe_lines TO venue_app;

CREATE FUNCTION app_private.prevent_closed_hospitality_consumption_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_order_id uuid;
  target_org_id uuid;
  target_event_id uuid;
  is_closed boolean;
BEGIN
  target_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hospitality_order_id ELSE NEW.hospitality_order_id END;
  target_org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF target_order_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT event_id INTO target_event_id FROM hospitality_orders
    WHERE id = target_order_id AND organization_id = target_org_id;
  SELECT state = 'CLOSED' INTO is_closed FROM event_closeouts
    WHERE event_id = target_event_id AND organization_id = target_org_id FOR UPDATE;
  IF COALESCE(is_closed, false) THEN
    RAISE EXCEPTION 'Event is closed; use the controlled post-close correction workflow.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hospitality_stock_consumption_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_hospitality_consumption_mutation();
REVOKE ALL ON FUNCTION app_private.prevent_closed_hospitality_consumption_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.prevent_closed_hospitality_consumption_mutation() TO venue_app;
