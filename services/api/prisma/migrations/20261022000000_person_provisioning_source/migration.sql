ALTER TABLE people
  ADD COLUMN provisioning_source text NOT NULL DEFAULT 'unknown'
  CHECK (provisioning_source IN ('unknown', 'sso', 'admin', 'scim'));

-- Existing rows predate provenance tracking, so do not guess their controller.
-- New SSO-created rows receive the ordinary default; SCIM/admin paths set theirs explicitly.
ALTER TABLE people ALTER COLUMN provisioning_source SET DEFAULT 'sso';
