-- Inventory overhaul, Phase 1: per-location balances and an append-only ledger.
-- Purely additive: no existing table is altered or dropped. Legacy
-- BarInventoryItem / DepartmentInventoryItem rows are copied in by
-- POST /v1/inventory/migrate-legacy, not by this migration.
-- See docs/inventory/phase-0-audit-and-plan.md.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "InventoryDomain" AS ENUM ('food', 'beverage', 'equipment', 'packaging', 'supply');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryLocationKind" AS ENUM (
    'department', 'kitchen', 'bar', 'concession_stand', 'suite', 'club', 'catering', 'warehouse',
    'storage', 'cooler', 'freezer', 'mobile_cart', 'event_storage', 'bin', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryTransactionType" AS ENUM (
    'opening_balance', 'receive', 'transfer_out', 'transfer_in', 'count_adjustment', 'waste', 'spoilage',
    'breakage', 'spill', 'return_to_vendor', 'vendor_credit', 'event_issue', 'event_return',
    'recipe_theoretical_usage', 'pos_estimated_depletion', 'manual_adjustment', 'equipment_checkout',
    'equipment_checkin', 'equipment_loss', 'equipment_retirement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "InventoryLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "InventoryLocationKind" NOT NULL DEFAULT 'storage',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "domain" "InventoryDomain" NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "domain" "InventoryDomain" NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "internalSku" TEXT,
    "barcode" TEXT,
    "vendorSku" TEXT,
    "brand" TEXT,
    "baseUnit" TEXT NOT NULL DEFAULT 'ea',
    "purchaseUnit" TEXT,
    "purchaseToBase" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "packSize" TEXT,
    "storageCondition" TEXT,
    "unitCostCents" DECIMAL(14,4),
    "lastCostCents" DECIMAL(14,4),
    "supplier" TEXT,
    "trackExpiration" BOOLEAN NOT NULL DEFAULT false,
    "trackLot" BOOLEAN NOT NULL DEFAULT false,
    "trackSerialNumber" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB,
    "imageUrl" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyBarItemId" TEXT,
    "legacyDepartmentItemId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "committed" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "par" DECIMAL(14,4),
    "reorderPoint" DECIMAL(14,4),
    "reorderQty" DECIMAL(14,4),
    "lastCountedAt" TIMESTAMP(3),
    "lastMovementAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "InventoryTransactionType" NOT NULL,
    "quantityBefore" DECIMAL(14,4) NOT NULL,
    "quantityAfter" DECIMAL(14,4) NOT NULL,
    "quantityDelta" DECIMAL(14,4) NOT NULL,
    "unitCostCents" DECIMAL(14,4),
    "valueDeltaCents" DECIMAL(14,4),
    "reasonCode" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id"),
    -- Ledger arithmetic must hold on every row, whatever wrote it.
    CONSTRAINT "InventoryTransaction_delta_check" CHECK ("quantityAfter" = "quantityBefore" + "quantityDelta")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLocation_facilityId_code_key" ON "InventoryLocation"("facilityId", "code");
CREATE INDEX IF NOT EXISTS "InventoryLocation_organizationId_facilityId_active_idx" ON "InventoryLocation"("organizationId", "facilityId", "active");
CREATE INDEX IF NOT EXISTS "InventoryLocation_facilityId_departmentId_idx" ON "InventoryLocation"("facilityId", "departmentId");
CREATE INDEX IF NOT EXISTS "InventoryLocation_parentId_idx" ON "InventoryLocation"("parentId");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCategory_facilityId_domain_slug_key" ON "InventoryCategory"("facilityId", "domain", "slug");
CREATE INDEX IF NOT EXISTS "InventoryCategory_facilityId_domain_active_idx" ON "InventoryCategory"("facilityId", "domain", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_legacyBarItemId_key" ON "InventoryItem"("legacyBarItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_legacyDepartmentItemId_key" ON "InventoryItem"("legacyDepartmentItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_facilityId_internalSku_key" ON "InventoryItem"("facilityId", "internalSku");
CREATE INDEX IF NOT EXISTS "InventoryItem_facilityId_domain_active_idx" ON "InventoryItem"("facilityId", "domain", "active");
CREATE INDEX IF NOT EXISTS "InventoryItem_facilityId_categoryId_idx" ON "InventoryItem"("facilityId", "categoryId");
CREATE INDEX IF NOT EXISTS "InventoryItem_facilityId_normalizedName_idx" ON "InventoryItem"("facilityId", "normalizedName");
CREATE INDEX IF NOT EXISTS "InventoryItem_facilityId_barcode_idx" ON "InventoryItem"("facilityId", "barcode");
CREATE INDEX IF NOT EXISTS "InventoryItem_facilityId_vendorSku_idx" ON "InventoryItem"("facilityId", "vendorSku");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_itemId_locationId_key" ON "InventoryBalance"("itemId", "locationId");
CREATE INDEX IF NOT EXISTS "InventoryBalance_facilityId_locationId_idx" ON "InventoryBalance"("facilityId", "locationId");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryTransaction_facilityId_idempotencyKey_key" ON "InventoryTransaction"("facilityId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "InventoryTransaction_facilityId_createdAt_idx" ON "InventoryTransaction"("facilityId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryTransaction_itemId_createdAt_idx" ON "InventoryTransaction"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryTransaction_locationId_createdAt_idx" ON "InventoryTransaction"("locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryTransaction_facilityId_referenceType_referenceId_idx" ON "InventoryTransaction"("facilityId", "referenceType", "referenceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryLocation_organizationId_fkey') THEN
    ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- The ledger is append-only. Corrections are new transactions, never edits.
-- Facility deletion still cascades: TRUNCATE-free cascade deletes run as the
-- table owner inside the FK action, so they are allowed through explicitly.
CREATE OR REPLACE FUNCTION app_private_inventory_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascaded from a Facility/Organization delete
  END IF;
  RAISE EXCEPTION 'InventoryTransaction is append-only; record a correcting transaction instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS "InventoryTransaction_append_only" ON "InventoryTransaction";
CREATE TRIGGER "InventoryTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "InventoryTransaction"
  FOR EACH ROW EXECUTE FUNCTION app_private_inventory_ledger_immutable();

-- Tenant isolation, same template as 20260908050000_department_inventory_rls.
ALTER TABLE "InventoryLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransaction" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    RAISE NOTICE 'stadium_api role absent; skipping tenant RLS policy coverage (applied at cutover).';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['InventoryLocation', 'InventoryCategory', 'InventoryItem', 'InventoryBalance', 'InventoryTransaction'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', lower(t) || '_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO stadium_api
         USING ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))
         WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", NULL)))',
      lower(t) || '_scope', t);
  END LOOP;
END
$$;
