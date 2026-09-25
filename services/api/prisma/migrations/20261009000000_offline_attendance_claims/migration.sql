CREATE TYPE staff_attendance_action AS ENUM ('CHECK_IN', 'CHECK_OUT');
CREATE TYPE staff_attendance_claim_status AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

CREATE TABLE staff_attendance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  worker_subject text NOT NULL,
  action staff_attendance_action NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status staff_attendance_claim_status NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text,
  CONSTRAINT staff_attendance_claims_shift_scope_fk FOREIGN KEY (shift_id, event_id, organization_id)
    REFERENCES staff_shifts(id, event_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_attendance_claims_review_fields CHECK (
    (status = 'PENDING_REVIEW' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (status IN ('ACCEPTED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason)) > 0)
  ),
  CONSTRAINT staff_attendance_claims_id_org_key UNIQUE (id, organization_id)
);
CREATE INDEX staff_attendance_claims_review_idx
  ON staff_attendance_claims (organization_id, event_id, status, received_at);
CREATE UNIQUE INDEX staff_attendance_claims_one_pending_action_idx
  ON staff_attendance_claims (organization_id, shift_id, worker_subject, action)
  WHERE status = 'PENDING_REVIEW';

CREATE FUNCTION app_private.guard_attendance_claim_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'PENDING_REVIEW'
    AND NEW.status IN ('ACCEPTED', 'REJECTED')
    AND NEW.id = OLD.id
    AND NEW.organization_id = OLD.organization_id
    AND NEW.event_id = OLD.event_id
    AND NEW.shift_id = OLD.shift_id
    AND NEW.worker_subject = OLD.worker_subject
    AND NEW.action = OLD.action
    AND NEW.recorded_at = OLD.recorded_at
    AND NEW.received_at = OLD.received_at
    AND NEW.reviewed_by IS NOT NULL
    AND NEW.reviewed_at IS NOT NULL
    AND NEW.review_reason IS NOT NULL
    AND length(trim(NEW.review_reason)) > 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'attendance claim evidence is immutable after submission';
END;
$$;
CREATE TRIGGER staff_attendance_claims_immutable
  BEFORE UPDATE OR DELETE ON staff_attendance_claims
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_attendance_claim_update();

ALTER TABLE staff_attendance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_claims_tenant_scope ON staff_attendance_claims
  USING (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_attendance_claims.shift_id AND s.event_id = staff_attendance_claims.event_id AND s.organization_id = staff_attendance_claims.organization_id))
  WITH CHECK (organization_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM staff_shifts s WHERE s.id = staff_attendance_claims.shift_id AND s.event_id = staff_attendance_claims.event_id AND s.organization_id = staff_attendance_claims.organization_id));
GRANT SELECT, INSERT, UPDATE ON TABLE staff_attendance_claims TO venue_app;
