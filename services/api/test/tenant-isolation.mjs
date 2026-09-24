import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const tenantC = '00000000-0000-4000-8000-000000000003';
const venueA = '10000000-0000-4000-8000-000000000001';
const annexVenueA = '10000000-0000-4000-8000-000000000003';
const venueB = '10000000-0000-4000-8000-000000000002';
const eventA = '20000000-0000-4000-8000-000000000001';
const eventB = '20000000-0000-4000-8000-000000000002';
const locationA = '30000000-0000-4000-8000-000000000001';
const annexLocationA = '30000000-0000-4000-8000-000000000004';
const locationB = '30000000-0000-4000-8000-000000000010';
const rollback = new Error('rollback tenant isolation fixtures');

async function setTenant(tx, tenantId) {
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

async function makeIssue(tx, { organizationId, eventId, venueId, locationId, title }) {
  return tx.issue.create({
    data: {
      organizationId,
      eventId,
      venueId,
      locationId,
      title,
      description: 'Temporary RLS integration fixture.',
      category: 'Service',
      severity: 'MODERATE',
      reporterId: 'tenant-isolation-test',
    },
  });
}

try {
  const [role] = await prisma.$queryRaw`
    SELECT current_user AS role, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user
  `;
  assert.equal(role.role, 'venue_app');
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);

  let issueAId;
  try {
    await prisma.$transaction(async (tx) => {
      await setTenant(tx, tenantA);
      const issueA = await makeIssue(tx, {
        organizationId: tenantA,
        eventId: eventA,
        venueId: venueA,
        locationId: locationA,
        title: `Tenant A ${randomUUID()}`,
      });
      issueAId = issueA.id;
      await tx.issueAuditEvent.create({ data: { organizationId: tenantA, issueId: issueA.id, actorId: 'tenant-isolation-test', action: 'reported' } });
      await tx.commandReceipt.create({ data: { organizationId: tenantA, key: `tenant-a-${randomUUID()}`, fingerprint: 'a', action: 'test', response: {} } });
      await tx.issueDomainEvent.create({ data: { organizationId: tenantA, eventId: eventA, issueId: issueA.id, action: 'reported', payload: { issueId: issueA.id } } });

      await setTenant(tx, tenantB);
      const issueB = await makeIssue(tx, {
        organizationId: tenantB,
        eventId: eventB,
        venueId: venueB,
        locationId: locationB,
        title: `Tenant B ${randomUUID()}`,
      });
      await tx.issueAuditEvent.create({ data: { organizationId: tenantB, issueId: issueB.id, actorId: 'tenant-isolation-test', action: 'reported' } });
      await tx.commandReceipt.create({ data: { organizationId: tenantB, key: `tenant-b-${randomUUID()}`, fingerprint: 'b', action: 'test', response: {} } });
      await tx.issueDomainEvent.create({ data: { organizationId: tenantB, eventId: eventB, issueId: issueB.id, action: 'reported', payload: { issueId: issueB.id } } });

      await setTenant(tx, tenantA);
      await assertTenantCannotRead(tx, tenantA, tenantB, issueB.id);
      const updated = await tx.issue.updateMany({ where: { id: issueB.id }, data: { title: 'forbidden update' } });
      const deleted = await tx.issue.deleteMany({ where: { id: issueB.id } });
      assert.equal(updated.count, 0, 'tenant A must not update tenant B issues');
      assert.equal(deleted.count, 0, 'tenant A must not delete tenant B issues');

      await setTenant(tx, tenantB);
      await assertTenantCannotRead(tx, tenantB, tenantA, issueA.id);
      throw rollback;
    });
    assert.fail('The fixture transaction should roll back.');
  } catch (error) {
    if (error !== rollback) throw error;
  }

  const invalidIssue = (locationId) => prisma.$transaction(async (tx) => {
    await setTenant(tx, tenantA);
    await makeIssue(tx, {
      organizationId: tenantA,
      eventId: eventA,
      venueId: venueA,
      locationId,
      title: `Invalid location ${randomUUID()}`,
    });
  });
  await assert.rejects(invalidIssue(locationB), 'tenant A must not attach tenant B location');
  await assert.rejects(invalidIssue(annexLocationA), 'tenant A must not attach a location from a different venue');

  await assert.rejects(prisma.$transaction(async (tx) => {
    await setTenant(tx, tenantA);
    await tx.organization.create({ data: { id: tenantC, name: 'forbidden cross-tenant organization' } });
  }), 'tenant A must not insert out-of-scope organization rows');

  process.stdout.write('Tenant isolation passed: reads, updates, deletes, inserts, and location-to-venue integrity.\n');
} finally {
  await prisma.$disconnect();
}

async function assertTenantCannotRead(tx, visibleTenant, hiddenTenant, hiddenIssueId) {
  assert.equal(await tx.organization.count({ where: { id: hiddenTenant } }), 0, `${visibleTenant} organization isolation`);
  assert.equal(await tx.venue.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} venue isolation`);
  assert.equal(await tx.event.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} event isolation`);
  assert.equal(await tx.location.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} location isolation`);
  assert.equal(await tx.issue.count({ where: { id: hiddenIssueId } }), 0, `${visibleTenant} issue isolation`);
  assert.equal(await tx.issueAuditEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} audit isolation`);
  assert.equal(await tx.commandReceipt.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} command receipt isolation`);
  assert.equal(await tx.issueDomainEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} event outbox isolation`);
}
