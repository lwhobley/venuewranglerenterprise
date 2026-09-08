import type { BeoStatus } from '@prisma/client';

export type HubDepartment =
  | 'kitchen'
  | 'banquet_floor'
  | 'bars'
  | 'suites'
  | 'warehouse'
  | 'staffing';

export interface KitchenSlice {
  notes?: string;
  prepTime?: string;
  specialInstructions?: string;
  menuItems?: Array<{
    name: string;
    quantity?: number;
    dietary?: string;
    course?: string;
  }>;
}

export interface BanquetFloorSlice {
  notes?: string;
  setupStyle?: string;
  tableCount?: number;
  headCount?: number;
  roomArrangement?: string;
}

export interface BarsSlice {
  notes?: string;
  barPackage?: string;
  stationLocations?: string[];
  specialtyCocktails?: string[];
}

export interface SuitesSlice {
  notes?: string;
  suiteNumber?: string;
  hostName?: string;
  parLevels?: string;
}

export interface WarehouseSlice {
  notes?: string;
  equipment?: string[];
  linens?: string;
  stagingLocation?: string;
}

export interface StaffingSlice {
  notes?: string;
  rosterSynced?: boolean;
  rosterSyncedAt?: string;
  requiredRoles?: Array<{
    role: string;
    count: number;
    hours?: string;
  }>;
}

export interface DepartmentSlices {
  kitchen?: KitchenSlice;
  banquetFloor?: BanquetFloorSlice;
  bars?: BarsSlice;
  suites?: SuitesSlice;
  warehouse?: WarehouseSlice;
  staffing?: StaffingSlice;
}

export interface CanonicalBeoInput {
  externalSource: string;
  externalId: string;
  eventName: string;
  serviceDate?: string | null;
  spaceId?: string | null;
  venueSpace?: string | null;
  loadInAt?: Date | string | null;
  serviceStartAt?: Date | string | null;
  serviceEndAt?: Date | string | null;
  loadOutAt?: Date | string | null;
  guestCount?: number | null;
  status?: BeoStatus;
  departmentSlices?: DepartmentSlices | null;
  layoutJson?: Record<string, unknown> | null;
  sourcePayload?: Record<string, unknown> | null;
  sourceFileUrl?: string | null;
  sourceUpdatedAt?: Date | string | null;
  leadId?: string | null;
  eventId?: string | null;
  fbMinimumCents?: number | null;
  depositCents?: number | null;
  specialRequirements?: string | null;
  internalNotes?: string | null;
  assignedRepId?: string | null;
}
