ALTER TABLE stock_items
  ADD CONSTRAINT stock_items_id_venue_org_key UNIQUE (id, venue_id, organization_id);

CREATE TABLE stock_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  location_id uuid,
  supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 2 AND 160),
  supplier_reference text NOT NULL DEFAULT '' CHECK (length(supplier_reference) <= 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  state text NOT NULL DEFAULT 'SUBMITTED' CHECK (state IN ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED_SHORT','CANCELLED')),
  requested_by text NOT NULL,
  approved_by text,
  received_by text,
  cancel_reason text,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  last_received_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT stock_purchase_orders_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT stock_purchase_orders_id_event_org_key UNIQUE (id, event_id, organization_id),
  CONSTRAINT stock_purchase_orders_id_event_venue_org_key UNIQUE (id, event_id, venue_id, organization_id),
  CONSTRAINT stock_purchase_orders_venue_org_fk FOREIGN KEY (venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT stock_purchase_orders_event_scope_fk FOREIGN KEY (event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT stock_purchase_orders_location_scope_fk FOREIGN KEY (location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id),
  CONSTRAINT stock_purchase_orders_close_reason_check CHECK (close_reason IS NULL OR length(btrim(close_reason)) BETWEEN 3 AND 500),
  CONSTRAINT stock_purchase_orders_cancel_reason_check CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 3 AND 500)
);
CREATE INDEX stock_purchase_orders_event_queue_idx ON stock_purchase_orders(organization_id, event_id, state, created_at DESC);
CREATE INDEX stock_purchase_orders_venue_supplier_idx ON stock_purchase_orders(organization_id, venue_id, supplier_name, created_at DESC);

CREATE TABLE stock_purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  ordered_quantity numeric(12,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  CONSTRAINT stock_purchase_order_lines_order_item_key UNIQUE (purchase_order_id, item_id),
  CONSTRAINT stock_purchase_order_lines_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT stock_purchase_order_lines_order_scope_fk FOREIGN KEY (purchase_order_id, event_id, venue_id, organization_id) REFERENCES stock_purchase_orders(id, event_id, venue_id, organization_id),
  CONSTRAINT stock_purchase_order_lines_item_scope_fk FOREIGN KEY (item_id, venue_id, organization_id) REFERENCES stock_items(id, venue_id, organization_id)
);
CREATE INDEX stock_purchase_order_lines_event_idx ON stock_purchase_order_lines(organization_id, event_id, purchase_order_id);

CREATE TABLE stock_purchase_order_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  purchase_order_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_purchase_order_audit_order_org_fk FOREIGN KEY (purchase_order_id, organization_id) REFERENCES stock_purchase_orders(id, organization_id)
);
CREATE INDEX stock_purchase_order_audit_history_idx ON stock_purchase_order_audit(organization_id, purchase_order_id, created_at);
CREATE TRIGGER stock_purchase_order_audit_immutable BEFORE UPDATE OR DELETE ON stock_purchase_order_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE event_closeout_followups DROP CONSTRAINT event_closeout_followups_source_type_check;
ALTER TABLE event_closeout_followups ADD CONSTRAINT event_closeout_followups_source_type_check
  CHECK (source_type IN ('ISSUE','TASK','ATTENDANCE','HOSPITALITY','STOCK_COUNT','STOCK_TRANSFER','STOCK_PURCHASE_ORDER'));

ALTER TABLE stock_movements ADD COLUMN purchase_order_id uuid;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('COUNT_ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','PURCHASE_RECEIPT'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_purchase_order_org_fk FOREIGN KEY (purchase_order_id, organization_id) REFERENCES stock_purchase_orders(id, organization_id);
CREATE INDEX stock_movements_purchase_order_idx ON stock_movements(organization_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['stock_purchase_orders','stock_purchase_order_lines','stock_purchase_order_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = app_private.current_tenant_id()) WITH CHECK (organization_id = app_private.current_tenant_id())', tbl || '_tenant_scope', tbl);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON stock_purchase_orders, stock_purchase_order_lines TO venue_app;
GRANT SELECT, INSERT ON stock_purchase_order_audit TO venue_app;

CREATE TRIGGER stock_purchase_orders_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON stock_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();
CREATE TRIGGER stock_purchase_order_lines_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON stock_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();

CREATE FUNCTION app_private.prevent_closed_purchase_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_org_id uuid;
  target_event_id uuid;
  is_closed boolean;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
  parent_org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF parent_id IS NOT NULL THEN
    SELECT event_id INTO target_event_id FROM stock_purchase_orders
      WHERE id = parent_id AND organization_id = parent_org_id;
    SELECT c.state = 'CLOSED' INTO is_closed FROM event_closeouts c
      WHERE c.event_id = target_event_id AND c.organization_id = parent_org_id FOR UPDATE;
    IF COALESCE(is_closed, false) THEN
      RAISE EXCEPTION 'Event is closed; use the controlled post-close correction workflow.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_purchase_receipt_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_purchase_receipt_mutation();
