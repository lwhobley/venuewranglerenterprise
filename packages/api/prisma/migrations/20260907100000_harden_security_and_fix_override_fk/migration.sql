-- Drop old compound foreign key that attempted ON DELETE SET NULL across non-nullable organizationId/facilityId
ALTER TABLE "UserAreaOverride" DROP CONSTRAINT IF EXISTS "UserAreaOverride_organizationId_facilityId_departmentId_fkey";

-- Re-add foreign key on departmentId referencing Department(id) with ON DELETE SET NULL
ALTER TABLE "UserAreaOverride" ADD CONSTRAINT "UserAreaOverride_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserAreaOverride_departmentId_idx" ON "UserAreaOverride"("departmentId");

-- Security hardening: revoke default PostgREST access on EventBeoReport from anon and authenticated
REVOKE ALL ON "EventBeoReport" FROM PUBLIC, anon, authenticated;

-- Security hardening: revoke execute privileges on trigger function in app_private
REVOKE ALL ON FUNCTION app_private.suite_beo_crm_beo_same_venue() FROM PUBLIC, anon, authenticated;
