-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'procurement_manager';

-- AlterTable
ALTER TABLE "InventoryTransferRequest"
  ALTER COLUMN "fromOutletId" DROP NOT NULL,
  ALTER COLUMN "toOutletId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "fromDepartmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "toDepartmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryTransferRequest_fromDepartmentId_status_idx" ON "InventoryTransferRequest"("fromDepartmentId", "status");
CREATE INDEX IF NOT EXISTS "InventoryTransferRequest_toDepartmentId_status_idx" ON "InventoryTransferRequest"("toDepartmentId", "status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryTransferRequest_fromDepartmentId_fkey'
  ) THEN
    ALTER TABLE "InventoryTransferRequest" ADD CONSTRAINT "InventoryTransferRequest_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryTransferRequest_toDepartmentId_fkey'
  ) THEN
    ALTER TABLE "InventoryTransferRequest" ADD CONSTRAINT "InventoryTransferRequest_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DepartmentInventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "par" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costCents" INTEGER,
    "location" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DepartmentInventoryMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "previousOnHand" DOUBLE PRECISION NOT NULL,
    "newOnHand" DOUBLE PRECISION NOT NULL,
    "referenceId" TEXT,
    "notes" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentInventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentInventoryItem_facilityId_departmentId_sku_key" ON "DepartmentInventoryItem"("facilityId", "departmentId", "sku");
CREATE INDEX IF NOT EXISTS "DepartmentInventoryItem_facilityId_departmentId_idx" ON "DepartmentInventoryItem"("facilityId", "departmentId");
CREATE INDEX IF NOT EXISTS "DepartmentInventoryItem_departmentId_name_idx" ON "DepartmentInventoryItem"("departmentId", "name");
CREATE INDEX IF NOT EXISTS "DepartmentInventoryItem_facilityId_status_idx" ON "DepartmentInventoryItem"("facilityId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DepartmentInventoryMovement_facilityId_departmentId_idx" ON "DepartmentInventoryMovement"("facilityId", "departmentId");
CREATE INDEX IF NOT EXISTS "DepartmentInventoryMovement_itemId_createdAt_idx" ON "DepartmentInventoryMovement"("itemId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryItem_organizationId_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryItem" ADD CONSTRAINT "DepartmentInventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryItem_organizationId_facilityId_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryItem" ADD CONSTRAINT "DepartmentInventoryItem_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryItem_org_facility_dept_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryItem" ADD CONSTRAINT "DepartmentInventoryItem_org_facility_dept_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryMovement_organizationId_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryMovement" ADD CONSTRAINT "DepartmentInventoryMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryMovement_org_facility_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryMovement" ADD CONSTRAINT "DepartmentInventoryMovement_org_facility_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryMovement_org_facility_dept_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryMovement" ADD CONSTRAINT "DepartmentInventoryMovement_org_facility_dept_fkey" FOREIGN KEY ("organizationId", "facilityId", "departmentId") REFERENCES "Department"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartmentInventoryMovement_itemId_fkey'
  ) THEN
    ALTER TABLE "DepartmentInventoryMovement" ADD CONSTRAINT "DepartmentInventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DepartmentInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
