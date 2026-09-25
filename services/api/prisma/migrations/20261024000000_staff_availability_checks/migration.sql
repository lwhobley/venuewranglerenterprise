CREATE TYPE staff_availability_check_response AS ENUM ('PENDING', 'AVAILABLE', 'UNAVAILABLE');

CREATE TABLE staff_availability_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  worker_subject text NOT NULL,
  shift_revision integer NOT NULL CHECK (shift_revision > 0),
  response staff_availability_check_response NOT NULL DEFAULT 'PENDING',
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT staff_availability_checks_scope_fk
    FOREIGN KEY (shift_id, event_id, organization_id)
    REFERENCES staff_shifts(id, event_id, organization_id),
  CONSTRAINT staff_availability_checks_worker_fk
    FOREIGN KEY (organization_id, worker_subject)
    REFERENCES people(organization_id, external_subject) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT staff_availability_checks_revision_unique
    UNIQUE (organization_id, shift_id, worker_subject, shift_revision),
  CONSTRAINT staff_availability_checks_response_time CHECK (
    (response = 'PENDING' AND responded_at IS NULL)
    OR (response <> 'PENDING' AND responded_at IS NOT NULL)
  )
);
CREATE INDEX staff_availability_checks_worker_idx
  ON staff_availability_checks (organization_id, worker_subject, response, requested_at DESC);
CREATE INDEX staff_availability_checks_shift_idx
  ON staff_availability_checks (organization_id, event_id, shift_id, shift_revision);

CREATE TABLE staff_availability_check_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  availability_check_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_check_audit_tenant_fk
    FOREIGN KEY (availability_check_id, organization_id)
    REFERENCES staff_availability_checks(id, organization_id)
);
CREATE INDEX staff_availability_check_audits_time_idx
  ON staff_availability_check_audits (organization_id, availability_check_id, created_at);
CREATE TRIGGER staff_availability_check_audits_immutable
  BEFORE UPDATE OR DELETE ON staff_availability_check_audits
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staff_availability_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_availability_checks_tenant_scope ON staff_availability_checks
  FOR SELECT USING (organization_id = app_private.current_tenant_id());
CREATE POLICY staff_availability_checks_tenant_insert ON staff_availability_checks
  FOR INSERT WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND requested_by = app_private.current_actor_id()
    AND EXISTS (
      SELECT 1 FROM staff_shifts s
      WHERE s.id = staff_availability_checks.shift_id
        AND s.event_id = staff_availability_checks.event_id
        AND s.organization_id = staff_availability_checks.organization_id
        AND s.state = 'DRAFT'
        AND s.assigned_subject IS NULL
        AND s.revision = staff_availability_checks.shift_revision
    )
  );
CREATE POLICY staff_availability_checks_worker_update ON staff_availability_checks
  FOR UPDATE USING (
    organization_id = app_private.current_tenant_id()
    AND worker_subject = app_private.current_actor_id()
    AND response = 'PENDING'
  ) WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND worker_subject = app_private.current_actor_id()
    AND response IN ('AVAILABLE', 'UNAVAILABLE')
    AND responded_at IS NOT NULL
  );
CREATE FUNCTION app_private.guard_staff_availability_check_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.worker_subject IS DISTINCT FROM OLD.worker_subject
    OR NEW.shift_revision IS DISTINCT FROM OLD.shift_revision
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR OLD.response <> 'PENDING'
    OR NEW.response NOT IN ('AVAILABLE', 'UNAVAILABLE')
    OR NEW.responded_at IS NULL
  THEN
    RAISE EXCEPTION 'Only a pending worker availability response may be recorded';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER staff_availability_checks_guard_update
  BEFORE UPDATE ON staff_availability_checks
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_staff_availability_check_update();
CREATE TRIGGER staff_availability_check_audits_immutable
  BEFORE UPDATE OR DELETE ON staff_availability_check_audits
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();

ALTER TABLE staff_availability_check_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability_check_audits FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_availability_check_audits_tenant_scope ON staff_availability_check_audits
  USING (
    organization_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM staff_availability_checks c
      WHERE c.id = staff_availability_check_audits.availability_check_id
        AND c.organization_id = staff_availability_check_audits.organization_id
    )
  )
  WITH CHECK (
    organization_id = app_private.current_tenant_id()
    AND actor_id = app_private.current_actor_id()
    AND EXISTS (
      SELECT 1 FROM staff_availability_checks c
      WHERE c.id = staff_availability_check_audits.availability_check_id
        AND c.organization_id = staff_availability_check_audits.organization_id
    )
  );

GRANT SELECT, INSERT, UPDATE ON staff_availability_checks TO venue_app;
GRANT SELECT, INSERT ON staff_availability_check_audits TO venue_app;
