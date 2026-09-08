-- AlterEnum
ALTER TYPE "BeoStatus" ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE "BeoStatus" ADD VALUE IF NOT EXISTS 'needs_review';
ALTER TYPE "BeoStatus" ADD VALUE IF NOT EXISTS 'in_service';
ALTER TYPE "BeoStatus" ADD VALUE IF NOT EXISTS 'closed';

-- AlterTable
ALTER TABLE "CrmBeo" ADD COLUMN IF NOT EXISTS "facilityId" TEXT,
ADD COLUMN IF NOT EXISTS "eventId" TEXT,
ADD COLUMN IF NOT EXISTS "spaceId" TEXT,
ADD COLUMN IF NOT EXISTS "externalSource" TEXT,
ADD COLUMN IF NOT EXISTS "externalId" TEXT,
ADD COLUMN IF NOT EXISTS "serviceDate" TEXT,
ADD COLUMN IF NOT EXISTS "loadInAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "serviceStartAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "serviceEndAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "loadOutAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "departmentSlices" JSONB,
ADD COLUMN IF NOT EXISTS "layoutJson" JSONB,
ADD COLUMN IF NOT EXISTS "sourcePayload" JSONB,
ADD COLUMN IF NOT EXISTS "sourceFileUrl" TEXT,
ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CrmBeo_venueId_externalSource_externalId_key" ON "CrmBeo"("venueId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmBeo_venueId_serviceDate_idx" ON "CrmBeo"("venueId", "serviceDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmBeo_venueId_eventId_idx" ON "CrmBeo"("venueId", "eventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrmBeo_facilityId_spaceId_serviceStartAt_idx" ON "CrmBeo"("facilityId", "spaceId", "serviceStartAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CrmBeo_eventId_fkey'
  ) THEN
    ALTER TABLE "CrmBeo" ADD CONSTRAINT "CrmBeo_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
