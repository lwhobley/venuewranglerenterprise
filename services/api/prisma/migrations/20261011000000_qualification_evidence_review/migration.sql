ALTER TABLE person_qualifications
  ADD COLUMN evidence_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN evidence_object_key text,
  ADD COLUMN evidence_file_name text,
  ADD COLUMN evidence_content_type text,
  ADD COLUMN evidence_size_bytes integer,
  ADD COLUMN evidence_sha256 text,
  ADD COLUMN evidence_uploaded_at timestamptz,
  ADD COLUMN evidence_reviewed_by text,
  ADD COLUMN evidence_reviewed_at timestamptz,
  ADD COLUMN evidence_review_reason text,
  ADD CONSTRAINT person_qualifications_evidence_status_check
    CHECK (evidence_status IN ('NONE', 'UPLOADING', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED')),
  ADD CONSTRAINT person_qualifications_evidence_metadata_check CHECK (
    (evidence_status = 'NONE' AND evidence_object_key IS NULL AND evidence_file_name IS NULL
      AND evidence_content_type IS NULL AND evidence_size_bytes IS NULL AND evidence_sha256 IS NULL
      AND evidence_uploaded_at IS NULL AND evidence_reviewed_by IS NULL AND evidence_reviewed_at IS NULL)
    OR (evidence_status = 'UPLOADING' AND evidence_object_key IS NOT NULL AND evidence_file_name IS NOT NULL
      AND evidence_content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp')
      AND evidence_size_bytes BETWEEN 1 AND 10485760 AND evidence_sha256 ~ '^[0-9a-f]{64}$'
      AND evidence_uploaded_at IS NULL AND evidence_reviewed_by IS NULL AND evidence_reviewed_at IS NULL)
    OR (evidence_status IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED') AND evidence_object_key IS NOT NULL
      AND evidence_file_name IS NOT NULL
      AND evidence_content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp')
      AND evidence_size_bytes BETWEEN 1 AND 10485760 AND evidence_sha256 ~ '^[0-9a-f]{64}$'
      AND evidence_uploaded_at IS NOT NULL)
  ),
  ADD CONSTRAINT person_qualifications_evidence_review_check CHECK (
    (evidence_status IN ('VERIFIED', 'REJECTED') AND evidence_reviewed_by IS NOT NULL
      AND evidence_reviewed_at IS NOT NULL AND evidence_review_reason IS NOT NULL
      AND length(btrim(evidence_review_reason)) BETWEEN 3 AND 500)
    OR (evidence_status IN ('NONE', 'UPLOADING', 'PENDING_REVIEW') AND evidence_reviewed_by IS NULL
      AND evidence_reviewed_at IS NULL AND evidence_review_reason IS NULL)
  );
