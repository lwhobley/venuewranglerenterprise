-- Removes the scheduling module and the guest CRM.
--
-- Scheduling goes entirely, model included: shifts, swaps, blackout dates,
-- staff availability, schedule templates and memory notes, plus the schedule
-- email log. Features that merely read the schedule keep working without it —
-- the time clock no longer gates an early punch or flags a late one, chat no
-- longer builds per-day crew channels, and the readiness scores drop their
-- staffing category and reweight the rest to still total 100.
--
-- The guest CRM goes except `CrmBeo`, which stays as a headless record: suite
-- orders link to it and the readiness `approvals` score still counts it.

-- Message references into the schedule.
DROP INDEX IF EXISTS "Message_shiftId_idx";
DROP INDEX IF EXISTS "Message_swapId_idx";
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_shiftId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_swapId_fkey";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "shiftId";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "swapId";

-- Guest links. The denormalized guestName/phone/email columns stay on both
-- tables, so a reservation or waitlist entry keeps the contact it captured.
DROP INDEX IF EXISTS "Reservation_guestId_idx";
DROP INDEX IF EXISTS "Waitlist_guestId_idx";
ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_guestId_fkey";
ALTER TABLE "Waitlist" DROP CONSTRAINT IF EXISTS "Waitlist_guestId_fkey";
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "guestId";
ALTER TABLE "Waitlist" DROP COLUMN IF EXISTS "guestId";

-- A sales BEO no longer hangs off a lead.
DROP INDEX IF EXISTS "CrmBeo_leadId_idx";
ALTER TABLE "CrmBeo" DROP CONSTRAINT IF EXISTS "CrmBeo_leadId_fkey";
ALTER TABLE "CrmBeo" DROP COLUMN IF EXISTS "leadId";

-- Scheduling tables, child-first.
DROP TABLE IF EXISTS "ShiftSwap";
DROP TABLE IF EXISTS "ScheduleShift";
DROP TABLE IF EXISTS "BlackoutDate";
DROP TABLE IF EXISTS "Availability";
DROP TABLE IF EXISTS "ScheduleTemplate";
DROP TABLE IF EXISTS "ScheduleMemoryNote";
DROP TABLE IF EXISTS "ScheduleEmailEvent";

-- Guest CRM tables, child-first. CrmBeo is deliberately retained.
DROP TABLE IF EXISTS "CrmActivityLog";
DROP TABLE IF EXISTS "CrmNote";
DROP TABLE IF EXISTS "CrmContract";
DROP TABLE IF EXISTS "CrmLead";
DROP TABLE IF EXISTS "Guest";
DROP TABLE IF EXISTS "EmailTemplate";

DROP TYPE IF EXISTS "CrmLeadStatus";
DROP TYPE IF EXISTS "ShiftStatus";
DROP TYPE IF EXISTS "ContractStatus";
