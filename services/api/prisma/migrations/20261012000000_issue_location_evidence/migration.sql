ALTER TABLE issues
  ADD COLUMN latitude numeric(8, 5),
  ADD COLUMN longitude numeric(8, 5),
  ADD COLUMN location_accuracy_meters numeric(7, 2),
  ADD COLUMN location_captured_at timestamptz;

ALTER TABLE issues
  ADD CONSTRAINT issues_location_evidence_complete CHECK (
    (latitude IS NULL AND longitude IS NULL AND location_accuracy_meters IS NULL AND location_captured_at IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
      AND location_accuracy_meters IS NOT NULL AND location_captured_at IS NOT NULL
      AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
      AND location_accuracy_meters BETWEEN 0 AND 10000)
  );
