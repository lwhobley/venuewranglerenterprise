-- Wage records must survive venue deletion (FLSA retention). Profile already
-- uses ON DELETE SET NULL; the venue FK was Cascade and would wipe punches.
ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_venueId_fkey";
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
