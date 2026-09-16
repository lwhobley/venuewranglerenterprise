import { describe, expect, it } from 'vitest';
import { canAssignEnterpriseRole } from './roles';

describe('canAssignEnterpriseRole', () => {
  it('lets platform admins assign any role', () => {
    expect(canAssignEnterpriseRole('platform_admin', 'platform_admin')).toBe(true);
    expect(canAssignEnterpriseRole('platform_admin', 'owner')).toBe(true);
  });

  it('never lets tenant admins grant platform or organization admin', () => {
    for (const actor of ['organization_admin', 'owner', 'admin']) {
      expect(canAssignEnterpriseRole(actor, 'platform_admin'), actor).toBe(false);
      expect(canAssignEnterpriseRole(actor, 'organization_admin'), actor).toBe(false);
    }
  });

  it('does not let an admin mint owners through an SSO group mapping', () => {
    expect(canAssignEnterpriseRole('admin', 'owner')).toBe(false);
    expect(canAssignEnterpriseRole('owner', 'owner')).toBe(true);
    expect(canAssignEnterpriseRole('organization_admin', 'owner')).toBe(true);
    expect(canAssignEnterpriseRole('admin', 'admin')).toBe(true);
    expect(canAssignEnterpriseRole('admin', 'event_manager')).toBe(true);
  });

  it('refuses roles that cannot manage SSO at all', () => {
    expect(canAssignEnterpriseRole('manager', 'staff')).toBe(false);
    expect(canAssignEnterpriseRole(undefined, 'staff')).toBe(false);
  });
});
