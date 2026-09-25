CREATE TABLE event_closeouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  venue_id uuid NOT NULL,
  event_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLOSED')),
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  finalized_by text,
  finalized_at timestamptz,
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  CONSTRAINT event_closeouts_id_org_key UNIQUE(id, organization_id),
  CONSTRAINT event_closeouts_event_unique UNIQUE(event_id),
  CONSTRAINT event_closeouts_event_tenant_unique UNIQUE(event_id, organization_id),
  CONSTRAINT event_closeouts_event_venue_tenant_unique UNIQUE(event_id, venue_id, organization_id),
  CONSTRAINT event_closeouts_event_scope_fk FOREIGN KEY(event_id, venue_id, organization_id) REFERENCES events(id, venue_id, organization_id),
  CONSTRAINT event_closeouts_finalization_check CHECK ((state = 'OPEN' AND finalized_by IS NULL AND finalized_at IS NULL) OR (state = 'CLOSED' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL))
);
CREATE INDEX event_closeouts_tenant_state_idx ON event_closeouts(organization_id, state, opened_at DESC);

CREATE TABLE event_closeout_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  closeout_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('ISSUE','TASK','ATTENDANCE','HOSPITALITY','STOCK_COUNT','STOCK_TRANSFER')),
  source_id text NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','FOLLOW_UP','ACCEPTED','DONE')),
  owner_subject text,
  due_at timestamptz,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_closeout_followups_source_unique UNIQUE(closeout_id, source_type, source_id),
  CONSTRAINT event_closeout_followups_closeout_tenant_fk FOREIGN KEY(closeout_id, organization_id) REFERENCES event_closeouts(id, organization_id),
  CONSTRAINT event_closeout_followups_followup_details CHECK (state NOT IN ('FOLLOW_UP','ACCEPTED') OR (length(btrim(reason)) >= 3)),
  CONSTRAINT event_closeout_followups_assigned_due CHECK (state <> 'FOLLOW_UP' OR (owner_subject IS NOT NULL AND due_at IS NOT NULL))
);
CREATE INDEX event_closeout_followups_state_idx ON event_closeout_followups(organization_id, closeout_id, state);

CREATE TABLE event_closeout_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  closeout_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_closeout_audit_closeout_tenant_fk FOREIGN KEY(closeout_id, organization_id) REFERENCES event_closeouts(id, organization_id)
);
CREATE INDEX event_closeout_audit_history_idx ON event_closeout_audit(organization_id, closeout_id, created_at);
CREATE TRIGGER event_closeout_audit_immutable BEFORE UPDATE OR DELETE ON event_closeout_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['event_closeouts','event_closeout_followups','event_closeout_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = app_private.current_tenant_id()) WITH CHECK (organization_id = app_private.current_tenant_id())', tbl || '_tenant_scope', tbl);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON event_closeouts, event_closeout_followups TO venue_app;
GRANT SELECT, INSERT ON event_closeout_audit TO venue_app;

CREATE FUNCTION app_private.prevent_closed_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_event_id uuid;
  is_closed boolean;
BEGIN
  target_event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  SELECT c.state = 'CLOSED' INTO is_closed FROM event_closeouts c
    WHERE c.event_id = target_event_id AND c.organization_id = app_private.current_tenant_id() FOR UPDATE;
  IF COALESCE(is_closed, false) THEN
    RAISE EXCEPTION 'Event is closed; use the controlled post-close correction workflow.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['issues','operational_tasks','staff_shifts','staffing_demands','staff_attendance_claims','hospitality_orders','stock_counts','stock_transfers','issue_attachments','external_integration_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_mutation()', tbl || '_open_event_required', tbl);
  END LOOP;
END $$;

CREATE FUNCTION app_private.prevent_closed_event_child_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_org_id uuid;
  target_event_id uuid;
  is_closed boolean;
BEGIN
  parent_org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  CASE TG_TABLE_NAME
    WHEN 'hospitality_order_lines' THEN
      parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
      SELECT event_id INTO target_event_id FROM hospitality_orders WHERE id = parent_id AND organization_id = parent_org_id;
    WHEN 'stock_count_lines' THEN
      parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.count_id ELSE NEW.count_id END;
      SELECT event_id INTO target_event_id FROM stock_counts WHERE id = parent_id AND organization_id = parent_org_id;
    WHEN 'stock_transfer_lines' THEN
      parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.transfer_id ELSE NEW.transfer_id END;
      SELECT event_id INTO target_event_id FROM stock_transfers WHERE id = parent_id AND organization_id = parent_org_id;
    WHEN 'staff_breaks' THEN
      parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.shift_id ELSE NEW.shift_id END;
      SELECT event_id INTO target_event_id FROM staff_shifts WHERE id = parent_id AND organization_id = parent_org_id;
    WHEN 'stock_movements' THEN
      parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.count_id ELSE NEW.count_id END;
      IF parent_id IS NOT NULL THEN
        SELECT event_id INTO target_event_id FROM stock_counts WHERE id = parent_id AND organization_id = parent_org_id;
      ELSE
        parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.transfer_id ELSE NEW.transfer_id END;
        IF parent_id IS NOT NULL THEN
          SELECT event_id INTO target_event_id FROM stock_transfers WHERE id = parent_id AND organization_id = parent_org_id;
        END IF;
      END IF;
  END CASE;
  IF target_event_id IS NOT NULL THEN
    SELECT c.state = 'CLOSED' INTO is_closed FROM event_closeouts c
      WHERE c.event_id = target_event_id AND c.organization_id = parent_org_id FOR UPDATE;
    IF COALESCE(is_closed, false) THEN
      RAISE EXCEPTION 'Event is closed; use the controlled post-close correction workflow.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['hospitality_order_lines','stock_count_lines','stock_transfer_lines','staff_breaks','stock_movements'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closed_event_child_mutation()', tbl || '_open_event_required', tbl);
  END LOOP;
END $$;
