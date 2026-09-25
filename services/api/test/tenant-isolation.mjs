import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../dist/audit.service.js';

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
const subjectA = 'https://test.invalid|worker-a';
const subjectB = 'https://test.invalid|worker-b';
const rollback = new Error('rollback tenant isolation fixtures');

async function setTenant(tx, tenantId, actorId = 'tenant-isolation-test') {
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${actorId}, true)`;
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
      const personA = await tx.person.create({ data: { organizationId: tenantA, externalSubject: subjectA, email: `${randomUUID()}@example.invalid`, displayName: 'Tenant A' } });
      const qualificationA = await tx.personQualification.create({ data: { organizationId: tenantA, personId: personA.id, code: 'FOOD_HANDLER', name: 'Food handler', createdBy: 'tenant-isolation-test' } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantA, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'qualification', resourceId: qualificationA.id, changedFields: ['qualification_code'] } });
      await setTenant(tx, tenantA, subjectA);
      const unavailableA = await tx.staffUnavailability.create({ data: { organizationId: tenantA, subject: subjectA, startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), note: 'test' } });
      await tx.staffUnavailabilityAudit.create({ data: { organizationId: tenantA, unavailabilityId: unavailableA.id, actorId: subjectA, action: 'created' } });
      await setTenant(tx, tenantA);
      const setupAuditA = await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantA, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'venue', resourceId: venueA, changedFields: ['name'] } });
      await tx.externalIntegrationEvent.create({ data: { organizationId: tenantA, eventId: eventA, source: 'test-labor', externalId: `tenant-a-${randomUUID()}`, eventType: 'test.snapshot', occurredAt: new Date(), payload: { tenant: 'a' }, bodySha256: 'a'.repeat(64) } });
      const taskA = await tx.operationalTask.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, kind: 'SERVICE', title: `Tenant A ${randomUUID()}`, createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.operationalTaskAudit.create({ data: { organizationId: tenantA, taskId: taskA.id, actorId: 'tenant-isolation-test', action: 'created' } });
      const shiftA = await tx.staffShift.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.staffShiftAuditEvent.create({ data: { organizationId: tenantA, shiftId: shiftA.id, actorId: 'tenant-isolation-test', action: 'created' } });
      await tx.userNotification.create({ data: { organizationId: tenantA, eventId: eventA, shiftId: shiftA.id, recipientSubject: 'tenant-isolation-test', kind: 'staffing.shift.published', title: 'Tenant A shift', body: 'Review shift.' } });
      await tx.userNotification.create({ data: { organizationId: tenantA, eventId: eventA, issueId: issueA.id, recipientSubject: 'tenant-isolation-test', kind: 'issue.assigned', title: 'Tenant A', body: 'Tenant A' } });
      await tx.issueAttachment.create({ data: { organizationId: tenantA, eventId: eventA, issueId: issueA.id, clientId: randomUUID(), uploadedBy: 'tenant-isolation-test', fileName: 'fixture.jpg', contentType: 'image/jpeg', sizeBytes: 1, sha256: 'a'.repeat(64), storageObjectKey: `tenant-a/${randomUUID()}` } });
      const pushTokenA = `tenant-a-push-token-${randomUUID()}-${randomUUID()}`;
      await tx.pushDevice.create({ data: { organizationId: tenantA, subject: 'tenant-isolation-test', installationId: randomUUID(), registrationToken: pushTokenA, tokenSha256: createHash('sha256').update(pushTokenA).digest('hex'), platform: 'ios' } });

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
      const personB = await tx.person.create({ data: { organizationId: tenantB, externalSubject: subjectB, email: `${randomUUID()}@example.invalid`, displayName: 'Tenant B' } });
      const qualificationB = await tx.personQualification.create({ data: { organizationId: tenantB, personId: personB.id, code: 'FOOD_HANDLER', name: 'Food handler', createdBy: 'tenant-isolation-test' } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantB, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'qualification', resourceId: qualificationB.id, changedFields: ['qualification_code'] } });
      await setTenant(tx, tenantB, subjectB);
      const unavailableB = await tx.staffUnavailability.create({ data: { organizationId: tenantB, subject: subjectB, startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z') } });
      await tx.staffUnavailabilityAudit.create({ data: { organizationId: tenantB, unavailabilityId: unavailableB.id, actorId: subjectB, action: 'created' } });
      await setTenant(tx, tenantB);
      const setupAuditB = await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantB, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'venue', resourceId: venueB, changedFields: ['name'] } });
      await tx.externalIntegrationEvent.create({ data: { organizationId: tenantB, eventId: eventB, source: 'test-labor', externalId: `tenant-b-${randomUUID()}`, eventType: 'test.snapshot', occurredAt: new Date(), payload: { tenant: 'b' }, bodySha256: 'b'.repeat(64) } });
      const taskB = await tx.operationalTask.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, kind: 'SERVICE', title: `Tenant B ${randomUUID()}`, createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.operationalTaskAudit.create({ data: { organizationId: tenantB, taskId: taskB.id, actorId: 'tenant-isolation-test', action: 'created' } });
      const shiftB = await tx.staffShift.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.staffShiftAuditEvent.create({ data: { organizationId: tenantB, shiftId: shiftB.id, actorId: 'tenant-isolation-test', action: 'created' } });
      await tx.userNotification.create({ data: { organizationId: tenantB, eventId: eventB, shiftId: shiftB.id, recipientSubject: 'tenant-isolation-test', kind: 'staffing.shift.published', title: 'Tenant B shift', body: 'Review shift.' } });
      await tx.userNotification.create({ data: { organizationId: tenantB, eventId: eventB, issueId: issueB.id, recipientSubject: 'tenant-isolation-test', kind: 'issue.assigned', title: 'Tenant B', body: 'Tenant B' } });
      await tx.issueAttachment.create({ data: { organizationId: tenantB, eventId: eventB, issueId: issueB.id, clientId: randomUUID(), uploadedBy: 'tenant-isolation-test', fileName: 'fixture.jpg', contentType: 'image/jpeg', sizeBytes: 1, sha256: 'b'.repeat(64), storageObjectKey: `tenant-b/${randomUUID()}` } });
      const pushTokenB = `tenant-b-push-token-${randomUUID()}-${randomUUID()}`;
      await tx.pushDevice.create({ data: { organizationId: tenantB, subject: 'tenant-isolation-test', installationId: randomUUID(), registrationToken: pushTokenB, tokenSha256: createHash('sha256').update(pushTokenB).digest('hex'), platform: 'android' } });

      await setTenant(tx, tenantA);
      assert.equal(await tx.userNotification.count({ where: { organizationId: tenantA, shiftId: shiftA.id, recipientSubject: 'tenant-isolation-test' } }), 1, 'the assigned worker can read the shift notification');
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees only its availability records');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its person qualifications');
      const auditService = new AuditService({
        withTenant: async (identity, action) => {
          await setTenant(tx, identity.tenantId, identity.subject);
          return action(tx);
        },
      });
      const auditA = await auditService.list({
        subject: 'tenant-isolation-test',
        tenantId: tenantA,
        capabilities: ['tenant:admin'],
        venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [],
      }, '100');
      assert.ok(auditA.items.some((row) => row.resourceId === issueA.id && row.resourceType === 'issue'));
      assert.ok(auditA.items.some((row) => row.resourceId === taskA.id && row.resourceType === 'task'));
      assert.ok(auditA.items.some((row) => row.resourceType === 'person'));
      assert.ok(auditA.items.some((row) => row.id === setupAuditA.id && row.resourceType === 'venue'));
      assert.equal(auditA.items.some((row) => row.resourceId === issueB.id || row.resourceId === taskB.id || row.id === setupAuditB.id), false, 'tenant A audit feed must exclude tenant B records');

      const auditB = await auditService.list({
        subject: 'tenant-isolation-test',
        tenantId: tenantB,
        capabilities: ['tenant:admin'],
        venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [],
      }, '100');
      assert.ok(auditB.items.some((row) => row.resourceId === issueB.id && row.resourceType === 'issue'));
      assert.ok(auditB.items.some((row) => row.resourceId === taskB.id && row.resourceType === 'task'));
      assert.ok(auditB.items.some((row) => row.id === setupAuditB.id && row.resourceType === 'venue'));
      assert.equal(auditB.items.some((row) => row.resourceId === issueA.id || row.resourceId === taskA.id || row.id === setupAuditA.id), false, 'tenant B audit feed must exclude tenant A records');

      await setTenant(tx, tenantA);
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B availability');
      assert.equal(await tx.staffUnavailabilityAudit.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B availability audit');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B qualifications');
      await assertTenantCannotRead(tx, tenantA, tenantB, issueB.id, taskB.id, shiftB.id);
      const updated = await tx.issue.updateMany({ where: { id: issueB.id }, data: { title: 'forbidden update' } });
      const deleted = await tx.issue.deleteMany({ where: { id: issueB.id } });
      const updatedTask = await tx.operationalTask.updateMany({ where: { id: taskB.id }, data: { title: 'forbidden update' } });
      const updatedShift = await tx.staffShift.updateMany({ where: { id: shiftB.id }, data: { role: 'forbidden update' } });
      assert.equal(updated.count, 0, 'tenant A must not update tenant B issues');
      assert.equal(deleted.count, 0, 'tenant A must not delete tenant B issues');
      assert.equal(updatedTask.count, 0, 'tenant A must not update tenant B operational tasks');
      assert.equal(updatedShift.count, 0, 'tenant A must not update tenant B staff shifts');

      await setTenant(tx, tenantB);
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability');
      assert.equal(await tx.staffUnavailabilityAudit.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability audit');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A qualifications');
      await assertTenantCannotRead(tx, tenantB, tenantA, issueA.id, taskA.id, shiftA.id);
      await setTenant(tx, tenantB, 'unrelated-recipient');
      assert.equal(await tx.userNotification.count({ where: { organizationId: tenantB } }), 0, 'notifications must only be visible to their recipient subject');
      assert.equal(await tx.pushDevice.count({ where: { organizationId: tenantB } }), 0, 'push tokens must only be visible to their registered subject');
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

  process.stdout.write('Tenant isolation passed: reads, updates, deletes, inserts, audit/event/device visibility, and location-to-venue integrity.\n');
} finally {
  await prisma.$disconnect();
}

async function assertTenantCannotRead(tx, visibleTenant, hiddenTenant, hiddenIssueId, hiddenTaskId, hiddenShiftId) {
  assert.equal(await tx.organization.count({ where: { id: hiddenTenant } }), 0, `${visibleTenant} organization isolation`);
  assert.equal(await tx.venue.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} venue isolation`);
  assert.equal(await tx.event.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} event isolation`);
  assert.equal(await tx.location.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} location isolation`);
  assert.equal(await tx.issue.count({ where: { id: hiddenIssueId } }), 0, `${visibleTenant} issue isolation`);
  assert.equal(await tx.issueAuditEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} audit isolation`);
  assert.equal(await tx.commandReceipt.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} command receipt isolation`);
  assert.equal(await tx.issueDomainEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} event outbox isolation`);
  assert.equal(await tx.person.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} people isolation`);
  assert.equal(await tx.personAuditEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} person audit isolation`);
  assert.equal(await tx.tenantSetupAuditEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} setup audit isolation`);
  assert.equal(await tx.operationalTask.count({ where: { id: hiddenTaskId } }), 0, `${visibleTenant} operational task isolation`);
  assert.equal(await tx.operationalTaskAudit.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} task audit isolation`);
  assert.equal(await tx.userNotification.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} notification isolation`);
  assert.equal(await tx.issueAttachment.count({ where: { issueId: hiddenIssueId } }), 0, `${visibleTenant} issue evidence isolation`);
  assert.equal(await tx.externalIntegrationEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} integration event isolation`);
  assert.equal(await tx.pushDevice.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} push device isolation`);
  assert.equal(await tx.staffShift.count({ where: { id: hiddenShiftId } }), 0, `${visibleTenant} staff shift isolation`);
  assert.equal(await tx.staffShiftAuditEvent.count({ where: { organizationId: hiddenTenant } }), 0, `${visibleTenant} staff shift audit isolation`);
}
