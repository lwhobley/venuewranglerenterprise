/**
 * Dual-Org Security & Boundary Partitioning
 *
 * Enforces access controls for contractor-in-building scenarios where:
 * - hostOrganizationId: Stadium / Landlord owner organization (building operator).
 * - operatorOrganizationId: Concessionaire / Food & Beverage contractor organization (e.g. Levy, Sportservice).
 */

export interface DualOrgEventDescriptor {
  organizationId?: string | null;
  hostOrganizationId?: string | null;
  operatorOrganizationId?: string | null;
}

export interface UserOrgScope {
  organizationId: string;
  role?: string | null;
  allAccess?: boolean;
}

/**
 * Validates whether a user's organization scope permits accessing the given dual-org event.
 */
export function canAccessDualOrgEvent(
  user: UserOrgScope,
  event: DualOrgEventDescriptor,
): boolean {
  if (user.allAccess) return true;
  const userOrg = user.organizationId;
  if (!userOrg) return false;

  // Direct match on primary organization
  if (event.organizationId && event.organizationId === userOrg) return true;

  // Dual-org host building organization match
  if (event.hostOrganizationId && event.hostOrganizationId === userOrg) return true;

  // Dual-org contractor/operator organization match
  if (event.operatorOrganizationId && event.operatorOrganizationId === userOrg) return true;

  return false;
}

/**
 * Redacts proprietary contractor financial and internal cost metrics when
 * the request is originating from a host building / landlord auditor account.
 */
export function filterDualOrgEventPayload<T extends Record<string, any>>(
  user: UserOrgScope,
  event: DualOrgEventDescriptor,
  payload: T,
): T {
  // If user is the contractor/operator or direct owner, they receive unredacted data
  const isOperator =
    user.allAccess ||
    (event.operatorOrganizationId && event.operatorOrganizationId === user.organizationId) ||
    (!event.operatorOrganizationId && event.organizationId === user.organizationId);

  if (isOperator) {
    return payload;
  }

  // Host/landlord organization view: Redact proprietary internal cost & margin items
  const redacted: any = Array.isArray(payload) ? [...payload] : { ...payload };

  const SENSITIVE_PROPRIETARY_KEYS = [
    'actualSalesCostCents',
    'laborCostCents',
    'forecastSalesCostCents',
    'internalHourlyWage',
    'contractorMarginPercent',
    'commissaryWholesaleCostCents',
  ];

  for (const key of SENSITIVE_PROPRIETARY_KEYS) {
    if (key in redacted) {
      redacted[key] = undefined;
    }
  }

  // If payload has an inner variance object or closeout details
  // Nested labor block, as returned by the event variance pack.
  if (redacted.labor && typeof redacted.labor === 'object') {
    redacted.labor = {
      ...redacted.labor,
      totalLaborCostCents: undefined,
      hourlyCostCents: undefined,
      budgetCostCents: undefined,
      forecastSalesCents: undefined,
    };
  }

  return redacted;
}
