-- Scope EventIssue replay keys to the venue rather than the organization.
--
-- The idempotency key was unique on ("organizationId", "clientMutationId"), so
-- two venues in one organization shared a key space. A client mutation id
-- reused across sibling venues made the replay lookup return the OTHER venue's
-- issue, and the caller's own issue could never be inserted.
--
-- The new constraint is strictly weaker than the old one (a venue belongs to
-- exactly one organization), so every row that satisfied the old index also
-- satisfies this one and the swap cannot fail on existing data.
DROP INDEX IF EXISTS "EventIssue_organizationId_clientMutationId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "EventIssue_venueId_clientMutationId_key"
  ON "EventIssue"("venueId", "clientMutationId") WHERE "clientMutationId" IS NOT NULL;
