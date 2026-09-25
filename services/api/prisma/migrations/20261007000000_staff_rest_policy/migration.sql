ALTER TABLE organizations
  ADD COLUMN minimum_rest_minutes smallint
    CHECK (minimum_rest_minutes IS NULL OR minimum_rest_minutes BETWEEN 0 AND 1440);

ALTER TABLE tenant_setup_audit_events DROP CONSTRAINT tenant_setup_audit_events_resource_type_check;
ALTER TABLE tenant_setup_audit_events ADD CONSTRAINT tenant_setup_audit_events_resource_type_check
  CHECK (resource_type IN ('organization', 'venue', 'location', 'event', 'qualification', 'staffing_policy'));
