import { describe, expect, it } from 'vitest';
import { canAccessDualOrgEvent, filterDualOrgEventPayload } from './dual-org-access';

describe('dual-org-access', () => {
  const hostOrg = 'org-building-landlord';
  const operatorOrg = 'org-concessionaire-levy';
  const unrelatedOrg = 'org-competitor';

  const dualOrgEvent = {
    organizationId: operatorOrg,
    hostOrganizationId: hostOrg,
    operatorOrganizationId: operatorOrg,
  };

  it('allows access for both host building and contractor operator organizations', () => {
    expect(canAccessDualOrgEvent({ organizationId: hostOrg, role: 'organization_admin' }, dualOrgEvent)).toBe(true);
    expect(canAccessDualOrgEvent({ organizationId: operatorOrg, role: 'fnb_director' }, dualOrgEvent)).toBe(true);
    expect(canAccessDualOrgEvent({ organizationId: unrelatedOrg, role: 'organization_admin' }, dualOrgEvent)).toBe(false);
  });

  it('permits platform admins with allAccess regardless of organization', () => {
    expect(canAccessDualOrgEvent({ organizationId: 'any', role: 'platform_admin', allAccess: true }, dualOrgEvent)).toBe(true);
  });

  it('preserves full financial detail for contractor operator accounts', () => {
    const payload = {
      attendance: 65000,
      grossSalesCents: 125000000,
      laborCostCents: 32000000,
      contractorMarginPercent: 24.5,
      labor: {
        totalHours: 1420,
        totalLaborCostCents: 32000000,
      },
    };

    const result = filterDualOrgEventPayload({ organizationId: operatorOrg }, dualOrgEvent, payload);
    expect(result.laborCostCents).toBe(32000000);
    expect(result.contractorMarginPercent).toBe(24.5);
    expect(result.labor.totalLaborCostCents).toBe(32000000);
  });

  it('redacts proprietary contractor wage & cost data when viewed by landlord/host building accounts', () => {
    const payload = {
      attendance: 65000,
      grossSalesCents: 125000000,
      laborCostCents: 32000000,
      contractorMarginPercent: 24.5,
      labor: {
        totalHours: 1420,
        totalLaborCostCents: 32000000,
      },
    };

    const result = filterDualOrgEventPayload({ organizationId: hostOrg }, dualOrgEvent, payload);
    expect(result.attendance).toBe(65000);
    expect(result.grossSalesCents).toBe(125000000);
    expect(result.laborCostCents).toBeUndefined();
    expect(result.contractorMarginPercent).toBeUndefined();
    expect(result.labor.totalHours).toBe(1420);
    expect(result.labor.totalLaborCostCents).toBeUndefined();
  });

  it('redacts labor cost and forecast from the event variance pack shape for host accounts', () => {
    const variancePack = {
      eventId: 'event-1',
      labor: { budgetHours: 1400, budgetCostCents: 3100000, forecastSalesCents: 8000000, actualSalesCents: 8500000, salesVarianceCents: 500000 },
    };
    const host = filterDualOrgEventPayload({ organizationId: hostOrg }, dualOrgEvent, variancePack);
    expect(host.labor.budgetCostCents).toBeUndefined();
    expect(host.labor.forecastSalesCents).toBeUndefined();
    expect(host.labor.budgetHours).toBe(1400);

    const operator = filterDualOrgEventPayload({ organizationId: operatorOrg }, dualOrgEvent, variancePack);
    expect(operator.labor.budgetCostCents).toBe(3100000);
  });

  it('treats a caller without an organization as a host, never as the operator', () => {
    const payload = { laborCostCents: 1, labor: { budgetCostCents: 2 } };
    const result = filterDualOrgEventPayload({ organizationId: undefined as unknown as string }, { organizationId: operatorOrg }, payload);
    expect(result.laborCostCents).toBeUndefined();
    expect(result.labor.budgetCostCents).toBeUndefined();
  });
});
