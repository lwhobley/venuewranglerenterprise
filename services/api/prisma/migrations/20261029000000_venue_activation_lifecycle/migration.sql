ALTER TABLE venues
  ADD COLUMN time_zone text,
  ADD COLUMN lifecycle_state text DEFAULT 'ACTIVE',
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN activated_by text;

-- A column default backfills existing rows even when the migrator cannot
-- UPDATE tenant-scoped rows under FORCE RLS. New venues default to DRAFT below.
ALTER TABLE venues
  ALTER COLUMN lifecycle_state SET DEFAULT 'DRAFT',
  ALTER COLUMN lifecycle_state SET NOT NULL,
  ADD CONSTRAINT venues_lifecycle_state_check
    CHECK (lifecycle_state IN ('DRAFT', 'ACTIVE', 'SUSPENDED')),
  ADD CONSTRAINT venues_activation_actor_check
    CHECK ((lifecycle_state = 'ACTIVE' AND
            ((activated_at IS NULL AND activated_by IS NULL) OR
             (activated_at IS NOT NULL AND activated_by IS NOT NULL)))
        OR (lifecycle_state <> 'ACTIVE' AND activated_at IS NULL AND activated_by IS NULL));
