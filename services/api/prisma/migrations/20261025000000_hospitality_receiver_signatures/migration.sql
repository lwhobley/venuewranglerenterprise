ALTER TABLE hospitality_delivery_receipts
  ADD COLUMN receiver_signature jsonb;

ALTER TABLE hospitality_delivery_receipts
  ADD CONSTRAINT hospitality_delivery_receipts_signature_array_check
  CHECK (receiver_signature IS NULL OR jsonb_typeof(receiver_signature) = 'array');
