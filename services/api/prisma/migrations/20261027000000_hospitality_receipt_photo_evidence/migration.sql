CREATE TABLE hospitality_delivery_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES events(id),
  order_id uuid NOT NULL,
  client_id uuid NOT NULL,
  uploaded_by text NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heic', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_key text NOT NULL UNIQUE,
  status attachment_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  CONSTRAINT hospitality_delivery_evidence_order_fk
    FOREIGN KEY (order_id, event_id, organization_id)
    REFERENCES hospitality_orders(id, event_id, organization_id),
  CONSTRAINT hospitality_delivery_evidence_scope_key
    UNIQUE (id, order_id, event_id, organization_id),
  CONSTRAINT hospitality_delivery_evidence_order_client_key
    UNIQUE (order_id, client_id)
);

CREATE INDEX hospitality_delivery_evidence_scope_idx
  ON hospitality_delivery_evidence(organization_id, event_id, order_id, created_at);

ALTER TABLE hospitality_delivery_receipts
  ADD COLUMN photo_evidence_id uuid;
ALTER TABLE hospitality_delivery_receipts
  ADD CONSTRAINT hospitality_delivery_receipts_photo_evidence_scope_key
  UNIQUE (photo_evidence_id, order_id, event_id, organization_id);
ALTER TABLE hospitality_delivery_receipts
  ADD CONSTRAINT hospitality_delivery_receipts_photo_evidence_fk
  FOREIGN KEY (photo_evidence_id, order_id, event_id, organization_id)
  REFERENCES hospitality_delivery_evidence(id, order_id, event_id, organization_id);

ALTER TABLE hospitality_delivery_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitality_delivery_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY hospitality_delivery_evidence_select ON hospitality_delivery_evidence
  FOR SELECT USING (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM hospitality_orders o
      WHERE o.id = hospitality_delivery_evidence.order_id
        AND o.event_id = hospitality_delivery_evidence.event_id
        AND o.organization_id = hospitality_delivery_evidence.organization_id
    )
  );
CREATE POLICY hospitality_delivery_evidence_insert_actor ON hospitality_delivery_evidence
  FOR INSERT WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id()
    AND EXISTS (
      SELECT 1 FROM hospitality_orders o
      WHERE o.id = hospitality_delivery_evidence.order_id
        AND o.event_id = hospitality_delivery_evidence.event_id
        AND o.organization_id = hospitality_delivery_evidence.organization_id
    )
  );
CREATE POLICY hospitality_delivery_evidence_update_actor ON hospitality_delivery_evidence
  FOR UPDATE USING (
    organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id()
  ) WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND uploaded_by = app_private.current_actor_id()
  );

CREATE FUNCTION app_private.guard_hospitality_delivery_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Hospitality delivery evidence cannot be deleted.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'PENDING_UPLOAD'::attachment_status
      OR NEW.status <> 'READY'::attachment_status
      OR NEW.ready_at IS NULL
      OR (to_jsonb(NEW) - ARRAY['status', 'ready_at']) <> (to_jsonb(OLD) - ARRAY['status', 'ready_at']) THEN
      RAISE EXCEPTION 'Hospitality delivery evidence is immutable except for upload completion.' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hospitality_delivery_evidence_guard
  BEFORE UPDATE OR DELETE ON hospitality_delivery_evidence
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_hospitality_delivery_evidence();
CREATE TRIGGER hospitality_delivery_evidence_open_event_required
  BEFORE INSERT OR UPDATE OR DELETE ON hospitality_delivery_evidence
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation();
REVOKE ALL ON FUNCTION app_private.guard_hospitality_delivery_evidence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.guard_hospitality_delivery_evidence() TO venue_app;

CREATE FUNCTION app_private.require_ready_hospitality_receipt_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.photo_evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hospitality_delivery_evidence evidence
    WHERE evidence.id = NEW.photo_evidence_id
      AND evidence.order_id = NEW.order_id
      AND evidence.event_id = NEW.event_id
      AND evidence.organization_id = NEW.organization_id
      AND evidence.status = 'READY'::public.attachment_status
  ) THEN
    RAISE EXCEPTION 'A receipt photo must be verified and belong to this order.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hospitality_delivery_receipt_photo_ready
  BEFORE INSERT ON hospitality_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.require_ready_hospitality_receipt_photo();
REVOKE ALL ON FUNCTION app_private.require_ready_hospitality_receipt_photo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.require_ready_hospitality_receipt_photo() TO venue_app;

GRANT SELECT, INSERT, UPDATE ON hospitality_delivery_evidence TO venue_app;
GRANT SELECT ON hospitality_delivery_evidence TO venue_migrator;
GRANT SELECT, INSERT ON hospitality_delivery_receipts TO venue_app;
