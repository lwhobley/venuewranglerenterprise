ALTER TABLE venues
  ADD COLUMN time_zone text,
  ADD COLUMN lifecycle_state text,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN activated_by text;

-- Preserve existing customer venues as active while requiring newly created
-- venues to complete the explicit setup review before event creation.
UPDATE venues SET lifecycle_state = 'ACTIVE';
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
