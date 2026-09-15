# Inventory Overhaul — Phase 0 Audit and Migration Plan

Source brief: `venue-wrangler-inventory-overhaul-build-prompt.docx` (five phases).
Decisions taken for this pass:

- **Scope:** Phase 0 (this document) + Phase 1 (foundation). Phases 2–5 follow as separate reviewable changes.
- **Backend:** NestJS + Prisma in `packages/api`, not Supabase RPC / Edge Functions. Balance changes run in
  Serializable Prisma transactions (`withSerializableRetry`), and tenant isolation uses the existing
  `stadium_api` RLS policy pattern plus the `FACILITY_SCOPED_MODELS` Prisma extension.
- **Existing data:** migrated into the new ledger, not left behind; old endpoints keep working during cut-over.

## 1. What exists today

| Area | Where | Shape | Notes |
| --- | --- | --- | --- |
| Inventory tab | `app/(tabs)/bar-stock.tsx` (1,479 lines) + `components/bar-stock/*` | One venue-wide list, area as free text | Counts, waste, CSV/AI import, velocity, shrinkage, PO suggestion, aging, prep/86 board |
| Bar inventory API | `modules/bar-inventory` — `v1/bar-inventory`, 25 routes | `BarInventoryItem` (venue-scoped) + `BarInventoryMovement` | `onHand`/`parLevel` are `Float`; one global quantity per item; area is a string |
| Department inventory API | `modules/departments` — `v1/departments/:id/inventory` | `DepartmentInventoryItem` + `DepartmentInventoryMovement` (facility-scoped, RLS on) | `Float` quantities, one row per dept+SKU, `Math.max(0, …)` silently clamps negatives |
| Transfers | `InventoryTransferRequest` | Items stored as a JSON array | Approval moves stock between department rows |
| POS | `modules/pos` — `PosConnection`, `PosCheck`, aggregator channels, 86 sync | Sales ingest + summaries | No menu-item → inventory mapping, no depletion |
| Vendors | `VmsVendor` | Staffing vendors, not suppliers | Not reusable as a supplier catalog |
| Stadium ops | `FnbOperationUnit`, `Outlet`, `FacilityZone`, `Department` | Physical service areas | Candidates to anchor inventory locations |

Tenant rule (CLAUDE.md): `Venue.id == Facility.id`; stadium modules pass `scope.venueId` into `facilityId`.

## 2. Gaps against the brief

- No per-location balance: both item tables hold a single `onHand`, which the brief forbids as the only source of truth.
- Quantities and costs are floating point; the brief requires decimal accounting.
- Movements do not record reason codes, value deltas, a reference type, or an idempotency key, and they are mutable rows.
- No location hierarchy, no Food / Beverage / Equipment separation, no alcohol-type taxonomy.
- Negative stock is clamped to zero silently instead of being refused or explicitly allowed.
- No recipes, menu items, POS mappings, purchase orders, receiving, count sessions, event packs, or equipment assets.

## 3. Target model (Phase 1 subset)

All new tables are facility-scoped (`organizationId`, `facilityId`) so they fit the stadium RLS policy
and the tenant-scope extension. IDs follow the codebase's `cuid()` convention rather than UUIDs, to
match every other table.

| Table | Purpose |
| --- | --- |
| `InventoryLocation` | Hierarchy node: department → service area → storage → bin (`parentId`, `kind`, `sortOrder` for count order) |
| `InventoryCategory` | Domain-scoped taxonomy (food / beverage / equipment / …), seeded with the brief's required categories, custom categories allowed |
| `InventoryItem` | Catalog record: domain, category, SKU, barcode, vendor SKU, units + conversion, storage condition, expiry/lot/serial flags, legacy links |
| `InventoryBalance` | Current state per **item + location**: on hand, committed, par, reorder point/qty, last counted |
| `InventoryTransaction` | Immutable ledger row for every stock change: before/after/delta, unit cost, value delta, reason, reference, idempotency key, actor |

Guarantees:

- Quantities are `Decimal(14,4)`; costs are `Decimal(14,4)` cents.
- The ledger is append-only: a database trigger rejects `UPDATE` and `DELETE` on `InventoryTransaction`.
- Balances change only through `InventoryLedgerService`, which locks the balance row, writes the transaction,
  and updates the balance in one Serializable transaction.
- Negative stock is refused unless the caller explicitly allows it (future per-location setting).
- `(facilityId, idempotencyKey)` is unique, so a retried request or a duplicated POS event cannot apply twice.

Deferred to later phases (tables from the brief not created in Phase 1): units table, bins table, count
sessions, transfer requests v2, event packs, vendors/vendor items, purchase orders, receiving, waste logs,
equipment checkouts/maintenance, recipes, menus, POS mappings/sync runs, alerts, saved views, attachments.

## 4. Migration plan

1. **Additive schema migration** (`20260915120000_inventory_ledger_foundation`): create the five tables, enums,
   indexes, the append-only trigger, and RLS policies guarded on `stadium_api` like
   `20260908050000_department_inventory_rls`. No existing table is altered or dropped.
2. **Backfill** via `POST /v1/inventory/migrate-legacy` (venue managers only, idempotent):
   - Seed the system taxonomy for the facility.
   - `BarInventoryItem` → `InventoryItem` (`legacyBarItemId` unique). Domain from its category
     (spirit/wine/beer/mixer → beverage; protein/produce/dairy/… → food; supply → packaging). Area string →
     `InventoryLocation`. On hand → an `opening_balance` transaction.
   - `DepartmentInventoryItem` → `InventoryItem` (`legacyDepartmentItemId` unique), location = the department.
   - Existing movement history stays in the legacy tables and remains visible there; only the current
     balance is carried over as the opening balance, so no historical row is rewritten.
   - Re-running skips anything already linked, so it is safe after partial failure.
3. **Compatibility:** `v1/bar-inventory` and `v1/departments/:id/inventory` are untouched in Phase 1. The old
   Inventory screen stays reachable from the new module as "Legacy bar stock". Phase 2 switches their writes to
   the ledger (dual-write), then Phase 5 retires them after operators confirm the balances.

### Risks

| Risk | Mitigation |
| --- | --- |
| Float → Decimal rounding on backfill | Rounded to 4 dp on the way in; opening balance equals the legacy value to 4 dp |
| Operators keep writing legacy tables after backfill | Backfill is re-runnable; Phase 2 dual-write closes the gap |
| Duplicate items across bar and department tables | Kept as separate items with separate legacy links; merge tooling is Phase 2 |
| RLS not active in environments without `stadium_api` | Same guard as existing migrations; the Prisma tenant extension still scopes queries |

## 5. Phase 1 deliverables

- Prisma models + migration + RLS + tenant-scope registration.
- `InventoryLedgerService` (atomic movements, pure movement maths unit-tested) and `InventoryService`
  (catalog, locations, categories, dashboard, transfers, legacy backfill).
- `v1/inventory` routes: `dashboard`, `items` (list/create/detail/update/archive), `locations`, `categories`,
  `transactions/adjust`, `transfers`, `migrate-legacy`.
- New Inventory module in the app: sub-navigation (Overview, Food, Beverage, Equipment), overview KPIs,
  virtualized catalog with category rail, search and stock-status filters, item detail with stock by location
  and history, adjust and transfer actions.

## 6. Phase 1 — what was built

### Routes and screens

| Route | Screen |
| --- | --- |
| `/inventory` (Inventory tab) | Overview: value by domain, below par, at risk of 86, locations, last count, needs-attention queue with Restock, value by location, recent activity, legacy import |
| `/inventory/food`, `/inventory/beverage`, `/inventory/equipment` | Catalog: search (name, SKU, barcode, vendor SKU, brand), category rail, stock-status filter, virtualized cards with quick Update |
| `/inventory/item/:id` | Item detail: summary, Count / Receive / Transfer / Waste, stock by location with inline par editing, details, ledger history |
| `/bar-stock` | Unchanged legacy screen, hidden from the tab bar, linked from the Overview |

### Database

- Migration `20260915120000_inventory_ledger_foundation`: `InventoryLocation`, `InventoryCategory`, `InventoryItem`,
  `InventoryBalance`, `InventoryTransaction` and three enums. Additive only.
- `InventoryTransaction` has a `quantityAfter = quantityBefore + quantityDelta` check constraint and an append-only
  trigger (cascade deletes from a facility/organization delete are let through).
- `(facilityId, idempotencyKey)` unique on the ledger.

### Security

- RLS enabled on all five tables with the `stadium_api` `scope_matches(organizationId, facilityId)` policy.
- All five registered in `FACILITY_SCOPED_MODELS`, so the Prisma tenant extension scopes every query.
- Catalog, category and location changes: venue managers and cross-department roles. Stock movements and pars:
  the same, or members of the department that owns the location. Reads: any venue member.

### API (`v1/inventory`)

`GET dashboard` · `GET/POST categories` · `GET/POST locations` · `GET/POST items` · `GET/PATCH items/:id` ·
`POST items/:id/active` · `POST items/:id/locations/:locationId` (par, reorder point, reorder qty) ·
`POST transactions` (receive, count, adjust, waste, spoilage, breakage, spill; `Idempotency-Key` honoured) ·
`POST transfers` (atomic out + in, `Idempotency-Key` honoured) · `POST migrate-legacy`.

### Tests

- `inventory-movement.spec.ts`: decimal arithmetic, no float drift, counts derive deltas, negative stock refused
  unless allowed, reasons required for losses and adjustments, valuation.
- `inventory-ledger.service.spec.ts`: row lock taken, balance and ledger written from the locked value, ledger never
  updated or deleted, idempotent replay moves nothing, reused key for a different movement rejected, negative
  refusal writes nothing, archived items and inactive locations refused.
- `tenant-scope.spec.ts` drift guard covers the new models.

### Manual test checklist

1. Open Inventory as a manager on a venue with legacy bar stock → **Import existing inventory** → counts shown; re-run
   imports nothing new.
2. Food / Beverage / Equipment show only their own items; spirits appear under their drink type.
3. Open an item → Count with a different quantity and no reason → Save stays disabled; pick a reason → saved; history
   shows before → after.
4. Waste more than is on hand → the server's "Only N on hand" message is shown and nothing changes.
5. Transfer between two locations → both balances change, history shows a transfer out and in with the same reference.
6. Set a par above on-hand → item shows Below par and appears in the Overview's Needs attention list.
7. As a staff member without a department location → movements are refused with a 403 message.
8. Double-tap Save on a receive → one ledger row.

### Known limitations and next steps

- The migration SQL has not been run against a live Postgres in this pass; apply it to a Supabase branch before
  production and confirm the trigger and RLS policies.
- Legacy screens still write the legacy tables. Re-running the import copies new items but does not reconcile
  quantity changes made in the legacy screens after the first import; Phase 2 moves legacy writes onto the ledger.
- Catalog filtering by stock status is done in memory over up to 5,000 items per venue, flagged in the UI when hit.
- Not yet built (Phase 2+): count sessions and blind counts, barcode scanning in the new screens, add-item form in
  the app (API exists), location management UI, receiving against POs, event packs, equipment check-out and
  maintenance, POS mapping and depletion, reports, alerts, saved views, attachments.
