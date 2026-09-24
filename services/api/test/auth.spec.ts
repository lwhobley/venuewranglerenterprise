import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertAssignable, assertCapability, assertScope, assertTenantAdmin, type Identity } from '../src/auth';

const identity: Identity = {
  subject: 'user-1',
  tenantId: 'tenant-1',
  capabilities: ['issue:read', 'operations:write', 'notification:read'],
  venueIds: ['venue-1'],
  eventIds: ['event-1'],
  locationIds: ['location-1'],
  assignableUserIds: ['user-2'],
};

describe('authorization assertions', () => {
  it('permits an action inside the identity capability and assigned venue/event/location scope', () => {
    expect(() => assertScope(identity, 'operations:write', 'event-1', 'venue-1', 'location-1')).not.toThrow();
  });

  it('denies a capability the identity does not have', () => {
    expect(() => assertScope(identity, 'issue:close', 'event-1')).toThrow(ForbiddenException);
  });

  it('denies events and venues outside the assigned scope', () => {
    expect(() => assertScope(identity, 'operations:write', 'event-2')).toThrow(ForbiddenException);
    expect(() => assertScope(identity, 'operations:write', 'event-1', 'venue-2')).toThrow(ForbiddenException);
  });

  it('denies locations outside the assigned scope', () => {
    expect(() => assertScope(identity, 'operations:write', 'event-1', 'venue-1', 'location-2')).toThrow(ForbiddenException);
  });

  it('allows assignment only to people in the identity assignment scope', () => {
    expect(() => assertAssignable(identity, 'user-2')).not.toThrow();
    expect(() => assertAssignable(identity, 'user-3')).toThrow(ForbiddenException);
  });

  it('requires tenant:admin for administrative operations', () => {
    expect(() => assertTenantAdmin(identity)).toThrow(ForbiddenException);
    expect(() => assertTenantAdmin({ ...identity, capabilities: [...identity.capabilities, 'tenant:admin'] })).not.toThrow();
  });

  it('checks standalone capabilities for notification and other capability-gated routes', () => {
    expect(() => assertCapability(identity, 'notification:read')).not.toThrow();
    expect(() => assertCapability(identity, 'tenant:admin')).toThrow(ForbiddenException);
  });
});
