CREATE TABLE hospitality_delivery_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  order_id uuid NOT NULL,
  actor_id text NOT NULL,
  received_by_name text NOT NULL CHECK (length(btrim(received_by_name)) BETWEEN 2 AND 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  receiver_acknowledged boolean NOT NULL CHECK (receiver_acknowledged),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_delivery_receipts_order_tenant_fk
    FOREIGN KEY (order_id, event_id, organization_id)
    REFERENCES hospitality_orders(id, event_id, organization_id),
  CONSTRAINT hospitality_delivery_receipts_once_per_order
    UNIQUE (order_id, event_id, organization_id)
);

CREATE INDEX hospitality_delivery_receipts_event_time_idx
  ON hospitality_delivery_receipts(organization_id, event_id, acknowledged_at);

ALTER TABLE hospitality_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_delivery_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_delivery_receipts_tenant_scope ON hospitality_delivery_receipts
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM hospitality_orders o
      WHERE o.id = hospitality_delivery_receipts.order_id
        AND o.event_id = hospitality_delivery_receipts.event_id
        AND o.organization_id = hospitality_delivery_receipts.organization_id
    )
  );

CREATE TRIGGER hospitality_delivery_receipts_immutable
  BEFORE UPDATE OR DELETE ON hospitality_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
CREATE TRIGGER hospitality_delivery_receipts_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON hospitality_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();

CREATE FUNCTION app_private.require_fully_fulfilled_hospitality_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  order_state public.hospitality_order_state;
BEGIN
  SELECT state INTO order_state FROM public.hospitality_orders
  WHERE id = NEW.order_id AND event_id = NEW.event_id AND organization_id = NEW.organization_id
  FOR UPDATE;
  IF order_state IS DISTINCT FROM 'DISTRIBUTED'::public.hospitality_order_state OR EXISTS (
    SELECT 1 FROM public.hospitality_order_lines l
    WHERE l.order_id = NEW.order_id AND l.organization_id = NEW.organization_id
      AND l.fulfilled_quantity < l.quantity
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hospitality_order_lines l
    WHERE l.order_id = NEW.order_id AND l.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'A delivery receipt requires a fully fulfilled hospitality order.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hospitality_delivery_receipts_fulfilled_order_required
  BEFORE INSERT ON hospitality_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.require_fully_fulfilled_hospitality_order();
REVOKE ALL ON FUNCTION app_private.require_fully_fulfilled_hospitality_order() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.require_fully_fulfilled_hospitality_order() TO venue_app;

GRANT SELECT, INSERT ON hospitality_delivery_receipts TO venue_app;
