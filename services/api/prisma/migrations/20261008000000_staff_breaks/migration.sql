CREATE TYPE staff_break_kind AS ENUM ('REST', 'MEAL');

CREATE TABLE staff_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  shift_id uuid NOT NULL,
  worker_subject text NOT NULL,
  kind staff_break_kind NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT staff_breaks_shift_tenant_fk FOREIGN KEY (shift_id, organization_id)
    REFERENCES staff_shifts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_breaks_time_order CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT staff_breaks_id_organization_key UNIQUE (id, organization_id)
);

CREATE INDEX staff_breaks_org_shift_started_idx ON staff_breaks (organization_id, shift_id, started_at);
CREATE UNIQUE INDEX staff_breaks_one_open_per_shift_idx ON staff_breaks (organization_id, shift_id) WHERE ended_at IS NULL;

CREATE FUNCTION app_private.prevent_staff_break_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.organization_id = OLD.organization_id
    AND NEW.shift_id = OLD.shift_id
    AND NEW.worker_subject = OLD.worker_subject
    AND NEW.kind = OLD.kind
    AND NEW.started_at = OLD.started_at
    AND NEW.ended_at >= OLD.started_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'staff break evidence is immutable except for ending an active break';
END;
$$;
CREATE TRIGGER staff_breaks_immutable
  BEFORE UPDATE OR DELETE ON staff_breaks
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_staff_break_rewrite();

ALTER TABLE staff_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_breaks FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_breaks_tenant_scope ON staff_breaks
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_breaks.shift_id AND s.organization_id = staff_breaks.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_breaks.shift_id AND s.organization_id = staff_breaks.organization_id));

GRANT SELECT, INSERT, UPDATE ON TABLE staff_breaks TO venue_app;
