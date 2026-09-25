ALTER TABLE person_audit_events
  DROP CONSTRAINT person_audit_events_action_check;

ALTER TABLE person_audit_events
  ADD CONSTRAINT person_audit_events_action_check
  CHECK (action IN ('insert', 'update', 'created', 'updated', 'deactivated', 'reactivated'));

CREATE OR REPLACE FUNCTION app_private.audit_person_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['active', 'display_name', 'email', 'external_subject', 'provisioning_source'];
  ELSE
    IF OLD.active IS DISTINCT FROM NEW.active THEN changed := array_append(changed, 'active'); END IF;
    IF OLD.display_name IS DISTINCT FROM NEW.display_name THEN changed := array_append(changed, 'display_name'); END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN changed := array_append(changed, 'email'); END IF;
    IF OLD.external_subject IS DISTINCT FROM NEW.external_subject THEN changed := array_append(changed, 'external_subject'); END IF;
    IF OLD.provisioning_source IS DISTINCT FROM NEW.provisioning_source THEN changed := array_append(changed, 'provisioning_source'); END IF;
  END IF;
  INSERT INTO public.person_audit_events (organization_id, person_id, actor_id, action, changed_fields)
  VALUES (NEW.organization_id, NEW.id, app_private.current_actor_id(), lower(TG_OP), changed);
  RETURN NEW;
END;
$$;
