CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  source_location_id uuid,
  destination_location_id uuid,
  state text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','IN_TRANSIT','RECEIVED','CANCELLED')),
  requested_by text NOT NULL,
  dispatched_by text,
  received_by text,
  request_note text NOT NULL DEFAULT '',
  reconciliation_reason text,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT stock_transfers_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT stock_transfers_id_event_org_key UNIQUE(id, event_id, organization_id),
  CONSTRAINT stock_transfers_venue_org_fk FOREIGN KEY(venue_id, organization_id) REFERENCES venues(id, organization_id),
  CONSTRAINT stock_transfers_event_scope_fk FOREIGN KEY(event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT stock_transfers_source_location_fk FOREIGN KEY(source_location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id),
  CONSTRAINT stock_transfers_destination_location_fk FOREIGN KEY(destination_location_id, venue_id, organization_id) REFERENCES locations(id, venue_id, organization_id),
  CONSTRAINT stock_transfers_distinct_locations CHECK (source_location_id IS DISTINCT FROM destination_location_id),
  CONSTRAINT stock_transfers_request_note_length CHECK (length(request_note) <= 500),
  CONSTRAINT stock_transfers_reconciliation_reason_length CHECK (reconciliation_reason IS NULL OR length(reconciliation_reason) BETWEEN 3 AND 500),
  CONSTRAINT stock_transfers_cancel_reason_length CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 500)
);
CREATE INDEX stock_transfers_event_queue_idx ON stock_transfers(organization_id, event_id, state, created_at DESC);
CREATE INDEX stock_transfers_location_queue_idx ON stock_transfers(organization_id, venue_id, destination_location_id, state, created_at DESC);

CREATE TABLE stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  transfer_id uuid NOT NULL,
  source_item_id uuid NOT NULL,
  destination_item_id uuid,
  requested_quantity numeric(12,3) NOT NULL CHECK (requested_quantity > 0),
  received_quantity numeric(12,3) CHECK (received_quantity >= 0 AND received_quantity <= requested_quantity),
  CONSTRAINT stock_transfer_lines_source_unique UNIQUE(transfer_id, source_item_id),
  CONSTRAINT stock_transfer_lines_transfer_org_fk FOREIGN KEY(transfer_id, organization_id) REFERENCES stock_transfers(id, organization_id),
  CONSTRAINT stock_transfer_lines_source_item_org_fk FOREIGN KEY(source_item_id, organization_id) REFERENCES stock_items(id, organization_id),
  CONSTRAINT stock_transfer_lines_destination_item_org_fk FOREIGN KEY(destination_item_id, organization_id) REFERENCES stock_items(id, organization_id)
);
CREATE INDEX stock_transfer_lines_transfer_idx ON stock_transfer_lines(organization_id, transfer_id);

CREATE TABLE stock_transfer_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  transfer_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_audit_transfer_org_fk FOREIGN KEY(transfer_id, organization_id) REFERENCES stock_transfers(id, organization_id)
);
CREATE INDEX stock_transfer_audit_history_idx ON stock_transfer_audit(organization_id, transfer_id, created_at);
CREATE TRIGGER stock_transfer_audit_immutable BEFORE UPDATE OR DELETE ON stock_transfer_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE stock_movements ADD COLUMN transfer_id uuid;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('COUNT_ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_transfer_org_fk FOREIGN KEY(transfer_id, organization_id) REFERENCES stock_transfers(id, organization_id);
CREATE INDEX stock_movements_transfer_idx ON stock_movements(organization_id, transfer_id) WHERE transfer_id IS NOT NULL;

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_tenant_scope ON stock_transfers
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_lines_tenant_scope ON stock_transfer_lines
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());
ALTER TABLE stock_transfer_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_audit_tenant_scope ON stock_transfer_audit
  USING (organization_id = app_private.current_tenant_id())
  WITH CHECK (organization_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON stock_transfers, stock_transfer_lines TO venue_app;
GRANT SELECT, INSERT ON stock_transfer_audit TO venue_app;
