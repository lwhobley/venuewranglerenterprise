ALTER TABLE people
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE people
  ADD CONSTRAINT people_id_organization_id_key UNIQUE (id, organization_id);

CREATE TABLE person_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  person_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update')),
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_audit_events_person_tenant_fk FOREIGN KEY (person_id, organization_id) REFERENCES people(id, organization_id)
);
CREATE INDEX person_audit_events_organization_person_created_idx
  ON person_audit_events (organization_id, person_id, created_at);

ALTER TABLE person_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY person_audit_events_tenant_select ON person_audit_events
  FOR SELECT USING (organization_id = app_private.current_tenant_id());
CREATE POLICY person_audit_events_tenant_insert ON person_audit_events
  FOR INSERT WITH CHECK (organization_id = app_private.current_tenant_id()
    AND actor_id = app_private.current_actor_id());
CREATE TRIGGER person_audit_events_immutable
  BEFORE UPDATE OR DELETE ON person_audit_events
  FOR EACH ROW EXECUTE FUNCTION app_private.prevent_audit_mutation();
GRANT SELECT, INSERT ON TABLE person_audit_events TO venue_app;

CREATE OR REPLACE FUNCTION app_private.audit_person_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['active', 'display_name', 'email', 'external_subject'];
  ELSE
    IF OLD.active IS DISTINCT FROM NEW.active THEN changed := array_append(changed, 'active'); END IF;
    IF OLD.display_name IS DISTINCT FROM NEW.display_name THEN changed := array_append(changed, 'display_name'); END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN changed := array_append(changed, 'email'); END IF;
    IF OLD.external_subject IS DISTINCT FROM NEW.external_subject THEN changed := array_append(changed, 'external_subject'); END IF;
  END IF;
  INSERT INTO public.person_audit_events (organization_id, person_id, actor_id, action, changed_fields)
  VALUES (NEW.organization_id, NEW.id, app_private.current_actor_id(), lower(TG_OP), changed);
  RETURN NEW;
END;
$$;
CREATE TRIGGER people_audit_mutations
  AFTER INSERT OR UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION app_private.audit_person_mutation();
