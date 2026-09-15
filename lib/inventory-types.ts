import { statusColors } from './theme';

/** Response shapes for /v1/inventory (packages/api/src/modules/inventory). */

export type InventoryDomain = 'food' | 'beverage' | 'equipment' | 'packaging' | 'supply';
export type StockStatus = 'out' | 'critical' | 'low' | 'ok' | 'untracked';
export type DirectMovementType =
  | 'receive' | 'count_adjustment' | 'manual_adjustment' | 'waste' | 'spoilage' | 'breakage' | 'spill';

export type InventoryItemSummary = {
  id: string;
  domain: InventoryDomain;
  name: string;
  brand: string | null;
  internalSku: string | null;
  barcode: string | null;
  baseUnit: string;
  category: { id: string; name: string } | null;
  active: boolean;
  supplier: string | null;
  unitCostCents: number | null;
  onHand: number;
  par: number | null;
  valueCents: number | null;
  status: StockStatus;
  locations: Array<{ id: string; name: string; onHand: number }>;
  lastCountedAt: string | null;
  lastMovementAt: string | null;
};

export type InventoryItemPage = {
  items: InventoryItemSummary[];
  total: number;
  nextOffset: number | null;
  truncated: boolean;
};

export type InventoryBalanceRow = {
  locationId: string;
  location: { id: string; name: string; kind: string };
  onHand: number;
  committed: number;
  available: number;
  par: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  status: StockStatus;
  lastCountedAt: string | null;
  lastMovementAt: string | null;
};

export type InventoryHistoryRow = {
  id: string;
  type: string;
  location: { id: string; name: string };
  quantityBefore: number;
  quantityAfter: number;
  quantityDelta: number;
  valueDeltaCents: number | null;
  reasonCode: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  userId: string | null;
  createdAt: string;
};

export type InventoryItemDetail = InventoryItemSummary & {
  description: string | null;
  vendorSku: string | null;
  purchaseUnit: string | null;
  purchaseToBase: number;
  packSize: string | null;
  storageCondition: string | null;
  lastCostCents: number | null;
  trackExpiration: boolean;
  notes: string | null;
  balances: InventoryBalanceRow[];
  history: InventoryHistoryRow[];
};

export type InventoryLocation = {
  id: string;
  name: string;
  code: string;
  kind: string;
  departmentId: string | null;
  parentId: string | null;
};

export type InventoryCategory = { id: string; domain: InventoryDomain; name: string; slug: string; isSystem: boolean };

export type InventoryDashboard = {
  totals: {
    valueCents: number;
    foodValueCents: number;
    beverageValueCents: number;
    equipmentValueCents: number;
    otherValueCents: number;
    itemCount: number;
    itemsByDomain: Record<InventoryDomain, number>;
    locationCount: number;
    belowParCount: number;
    atRiskCount: number;
    lastCountedAt: string | null;
  };
  attention: Array<{
    itemId: string; name: string; domain: InventoryDomain; locationId: string; location: string;
    onHand: number; par: number; unit: string; status: StockStatus;
  }>;
  valueByLocation: Array<{ id: string; name: string; valueCents: number }>;
  recentActivity: Array<{
    id: string; type: string; item: { id: string; name: string; baseUnit: string };
    location: { id: string; name: string }; quantityDelta: number; quantityAfter: number;
    reasonCode: string | null; createdAt: string;
  }>;
};

export type LegacyMigrationSummary = {
  barItems: number;
  departmentItems: number;
  skipped: number;
  failed: Array<{ source: string; id: string; error: string }>;
};

export const CATALOG_DOMAINS: Array<{ key: 'food' | 'beverage' | 'equipment'; label: string; icon: string }> = [
  { key: 'food', label: 'Food', icon: 'food-drumstick-outline' },
  { key: 'beverage', label: 'Beverage', icon: 'glass-cocktail' },
  { key: 'equipment', label: 'Equipment', icon: 'toolbox-outline' },
];

export const STOCK_STATUS_META: Record<StockStatus, { label: string; color: string }> = {
  out: { label: 'Out', color: statusColors.alert },
  critical: { label: 'Critical', color: statusColors.alert },
  low: { label: 'Below par', color: statusColors.needs_review },
  ok: { label: 'In stock', color: statusColors.confirmed },
  untracked: { label: 'No par', color: statusColors.closed },
};

export const MOVEMENT_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  receive: 'Received',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
  count_adjustment: 'Count',
  manual_adjustment: 'Adjustment',
  waste: 'Waste',
  spoilage: 'Spoilage',
  breakage: 'Breakage',
  spill: 'Spill',
  return_to_vendor: 'Returned to vendor',
  vendor_credit: 'Vendor credit',
  event_issue: 'Issued to event',
  event_return: 'Returned from event',
  recipe_theoretical_usage: 'Recipe usage',
  pos_estimated_depletion: 'POS depletion',
  equipment_checkout: 'Checked out',
  equipment_checkin: 'Checked in',
  equipment_loss: 'Lost',
  equipment_retirement: 'Retired',
};

/** Reason codes from the brief; required for counts, adjustments and losses. */
export const REASON_CODES: Array<{ code: string; label: string }> = [
  { code: 'count_correction', label: 'Count correction' },
  { code: 'spoilage', label: 'Spoilage' },
  { code: 'waste', label: 'Waste' },
  { code: 'breakage', label: 'Breakage' },
  { code: 'spill', label: 'Spill' },
  { code: 'theft_suspected', label: 'Theft / loss suspected' },
  { code: 'returned_to_vendor', label: 'Returned to vendor' },
  { code: 'vendor_credit', label: 'Vendor credit' },
  { code: 'event_usage', label: 'Event usage' },
  { code: 'complimentary', label: 'Complimentary item' },
  { code: 'recipe_yield', label: 'Recipe / yield issue' },
  { code: 'pos_mapping', label: 'POS mapping issue' },
];

export const REASON_REQUIRED: ReadonlySet<DirectMovementType> = new Set([
  'count_adjustment', 'manual_adjustment', 'waste', 'spoilage', 'breakage', 'spill',
]);

export function formatQuantity(value: number | null | undefined, unit?: string): string {
  if (value == null) return '—';
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
  return unit ? `${text} ${unit}` : text;
}

export function isCatalogDomain(value: unknown): value is 'food' | 'beverage' | 'equipment' {
  return value === 'food' || value === 'beverage' || value === 'equipment';
}
