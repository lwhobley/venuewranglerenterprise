ALTER TYPE hospitality_order_state ADD VALUE 'PARTIALLY_DISTRIBUTED';

ALTER TABLE hospitality_order_lines
  ADD COLUMN fulfilled_quantity numeric(10,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT hospitality_order_line_fulfilled_quantity_check
    CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity),
  ADD CONSTRAINT hospitality_order_lines_id_order_org_key
    UNIQUE (id, order_id, organization_id);

CREATE TABLE hospitality_order_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  actor_id text NOT NULL,
  quantity numeric(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  substitute_item_name text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_order_fulfillments_order_tenant_fk
    FOREIGN KEY (order_id, event_id, organization_id)
    REFERENCES hospitality_orders(id, event_id, organization_id),
  CONSTRAINT hospitality_order_fulfillments_line_tenant_fk
    FOREIGN KEY (line_id, order_id, organization_id)
    REFERENCES hospitality_order_lines(id, order_id, organization_id),
  CONSTRAINT hospitality_order_fulfillments_substitute_length
    CHECK (substitute_item_name IS NULL OR length(btrim(substitute_item_name)) BETWEEN 2 AND 160),
  CONSTRAINT hospitality_order_fulfillments_reason_length
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT hospitality_order_fulfillments_substitute_reason_required
    CHECK (substitute_item_name IS NULL OR reason IS NOT NULL)
);

CREATE INDEX hospitality_order_fulfillments_queue_idx
  ON hospitality_order_fulfillments(organization_id, event_id, order_id, created_at);

CREATE FUNCTION app_private.enforce_hospitality_fulfillment_quantity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  requested_quantity numeric(10,3);
  fulfilled_quantity numeric(10,3);
BEGIN
  SELECT quantity INTO requested_quantity
  FROM public.hospitality_order_lines
  WHERE id = NEW.line_id AND order_id = NEW.order_id AND organization_id = NEW.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fulfillment line is not part of this order.' USING ERRCODE = '23503';
  END IF;
  SELECT COALESCE(sum(quantity), 0) INTO fulfilled_quantity
  FROM public.hospitality_order_fulfillments
  WHERE line_id = NEW.line_id AND order_id = NEW.order_id AND organization_id = NEW.organization_id;
  IF fulfilled_quantity + NEW.quantity > requested_quantity THEN
    RAISE EXCEPTION 'Fulfillment exceeds the requested line quantity.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app_private.refresh_hospitality_line_fulfilled_quantity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.hospitality_order_lines
  SET fulfilled_quantity = (
    SELECT COALESCE(sum(quantity), 0)
    FROM public.hospitality_order_fulfillments
    WHERE line_id = NEW.line_id AND order_id = NEW.order_id AND organization_id = NEW.organization_id
  )
  WHERE id = NEW.line_id AND order_id = NEW.order_id AND organization_id = NEW.organization_id;
  RETURN NEW;
END $$;

CREATE TRIGGER hospitality_order_fulfillments_quantity_guard
  BEFORE INSERT ON hospitality_order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_hospitality_fulfillment_quantity();
CREATE TRIGGER hospitality_order_fulfillments_refresh_line
  AFTER INSERT ON hospitality_order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION app_private.refresh_hospitality_line_fulfilled_quantity();
REVOKE ALL ON FUNCTION app_private.refresh_hospitality_line_fulfilled_quantity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.refresh_hospitality_line_fulfilled_quantity() TO venue_app;
REVOKE ALL ON FUNCTION app_private.enforce_hospitality_fulfillment_quantity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.enforce_hospitality_fulfillment_quantity() TO venue_app;

ALTER TABLE hospitality_order_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_order_fulfillments FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_order_fulfillments_tenant_scope ON hospitality_order_fulfillments
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM hospitality_orders o
      WHERE o.id = hospitality_order_fulfillments.order_id
        AND o.event_id = hospitality_order_fulfillments.event_id
        AND o.organization_id = hospitality_order_fulfillments.organization_id
    )
  );

CREATE TRIGGER hospitality_order_fulfillments_immutable
  BEFORE UPDATE OR DELETE ON hospitality_order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
CREATE TRIGGER hospitality_order_fulfillments_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON hospitality_order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();
GRANT SELECT, INSERT ON hospitality_order_fulfillments TO venue_app;
