-- Enable RLS and add the stadium_api tenant-isolation policy for
-- DepartmentInventoryItem and DepartmentInventoryMovement.
--
-- 20260907180000_department_isolated_inventory created both tables after the
-- 20260805120000 lockdown without enabling RLS on them, leaving a gap in the
-- coverage 20260903130000 was meant to close. Both tables are facility-scoped
-- (organizationId + facilityId, no venueId or zoneId column) and are already
-- listed in FACILITY_SCOPED_MODELS (packages/api/src/prisma/tenant-scope.ts),
-- so app_private.scope_matches(organizationId, facilityId, NULL) -- the same
-- template used for TempAgency and WorkerProfile -- is the correct policy.
--
-- ENABLE ROW LEVEL SECURITY is unconditional and safe in any environment
-- (mirrors 20260808150000_harden_ai_usage_event_rls). The CREATE POLICY is
-- guarded on the stadium_api role existing, matching 20260903130000: plain
-- Postgres CI has no such role, and under the current bypass role this is
-- purely additive.
ALTER TABLE "DepartmentInventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentInventoryMovement" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    RAISE NOTICE 'stadium_api role absent; skipping tenant RLS policy coverage (applied at cutover).';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "department_inventory_item_scope" ON "DepartmentInventoryItem";
  CREATE POLICY "department_inventory_item_scope" ON "DepartmentInventoryItem"
    FOR ALL TO stadium_api
    USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))
    WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));

  DROP POLICY IF EXISTS "department_inventory_movement_scope" ON "DepartmentInventoryMovement";
  CREATE POLICY "department_inventory_movement_scope" ON "DepartmentInventoryMovement"
    FOR ALL TO stadium_api
    USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))
    WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)));
END
$$;
