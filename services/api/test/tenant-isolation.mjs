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

  const [rlsCoverage] = await prisma.$queryRaw`
    SELECT count(*) AS table_count,
           count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname = n.nspname AND p.tablename = c.relname
           )) AS protected_table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
  `;
  assert.ok(rlsCoverage.table_count > 0n, 'application schema must contain tables');
  assert.equal(
    rlsCoverage.protected_table_count,
    rlsCoverage.table_count,
    'every application table must have RLS, FORCE RLS, and at least one policy',
  );

  let issueAId;
  let breakAId;
  let attendanceClaimAId;
  let demandAId;
  let demandAuditAId;
  let breakBId;
  let attendanceClaimBId;
  let demandBId;
  let demandAuditBId;
  let stockTransferAId;
  let stockTransferBId;
  let stockPurchaseOrderAId;
  let stockPurchaseOrderBId;
  let stockCountAId;
  let stockCountBId;
  let hospitalityOrderAId;
  let hospitalityOrderBId;
  let hospitalityOrderLineAId;
  let hospitalityOrderLineBId;
  let closeoutAId;
  let closeoutBId;
  let closeoutFollowupAId;
  let closeoutFollowupBId;
  let vendorRequestAId;
  let vendorRequestBId;
  let hospitalityMenuItemAId;
  let hospitalityMenuItemBId;
  let availabilityCheckAId;
  let availabilityCheckBId;
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
      await tx.personAuditEvent.create({ data: { organizationId: tenantA, personId: personA.id, actorId: 'tenant-isolation-test', action: 'created', changedFields: ['provisioning_source'] } });
      await tx.personAuditEvent.create({ data: { organizationId: tenantA, personId: personA.id, actorId: 'tenant-isolation-test', action: 'deactivated', changedFields: ['active'] } });
      await tx.person.update({ where: { id: personA.id }, data: { provisioningSource: 'scim' } });
      const sourceAudit = await tx.personAuditEvent.findFirst({ where: { organizationId: tenantA, personId: personA.id, action: 'update' }, orderBy: { createdAt: 'desc' } });
      assert.ok(sourceAudit?.changedFields.includes('provisioning_source'), 'provisioning source changes are captured by the database audit trigger');
      const qualificationA = await tx.personQualification.create({ data: { organizationId: tenantA, personId: personA.id, code: 'FOOD_HANDLER', name: 'Food handler', createdBy: 'tenant-isolation-test', evidenceStatus: 'VERIFIED', evidenceObjectKey: `tenants/${tenantA}/qualifications/test`, evidenceFileName: 'food-handler.pdf', evidenceContentType: 'application/pdf', evidenceSizeBytes: 128, evidenceSha256: 'a'.repeat(64), evidenceUploadedAt: new Date(), evidenceReviewedBy: 'tenant-isolation-test', evidenceReviewedAt: new Date(), evidenceReviewReason: 'Tenant isolation fixture verified.' } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantA, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'qualification', resourceId: qualificationA.id, changedFields: ['qualification_code'] } });
      await setTenant(tx, tenantA, subjectA);
      const unavailableA = await tx.staffUnavailability.create({ data: { organizationId: tenantA, subject: subjectA, startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), note: 'test' } });
      await tx.staffUnavailabilityAudit.create({ data: { organizationId: tenantA, unavailabilityId: unavailableA.id, actorId: subjectA, action: 'created' } });
      await setTenant(tx, tenantA);
      const setupAuditA = await tx.tenantSetupAuditEvent.create({ data: { organizationId: tenantA, actorId: 'tenant-isolation-test', action: 'created', resourceType: 'venue', resourceId: venueA, changedFields: ['name'] } });
      await tx.externalIntegrationEvent.create({ data: { organizationId: tenantA, eventId: eventA, source: 'test-labor', externalId: `tenant-a-${randomUUID()}`, eventType: 'test.snapshot', occurredAt: new Date(), payload: { tenant: 'a' }, bodySha256: 'a'.repeat(64) } });
      const taskA = await tx.operationalTask.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, kind: 'SERVICE', title: `Tenant A ${randomUUID()}`, createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.operationalTaskAudit.create({ data: { organizationId: tenantA, taskId: taskA.id, actorId: 'tenant-isolation-test', action: 'created' } });
      const shiftA = await tx.staffShift.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, assignedSubject: subjectA, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 1, attendance: 'CHECKED_IN', checkedInAt: new Date('2026-10-01T17:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.staffShiftAuditEvent.create({ data: { organizationId: tenantA, shiftId: shiftA.id, actorId: 'tenant-isolation-test', action: 'created' } });
      const availabilityShiftA = await tx.staffShift.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, role: 'Availability fixture', startsAt: new Date('2026-10-02T17:00:00Z'), endsAt: new Date('2026-10-02T22:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      const availabilityCheckA = await tx.staffAvailabilityCheck.create({ data: { organizationId: tenantA, eventId: eventA, shiftId: availabilityShiftA.id, workerSubject: subjectA, shiftRevision: 1, requestedBy: 'tenant-isolation-test' } });
      availabilityCheckAId = availabilityCheckA.id;
      await tx.staffAvailabilityCheckAudit.create({ data: { organizationId: tenantA, availabilityCheckId: availabilityCheckA.id, actorId: 'tenant-isolation-test', action: 'requested' } });
      await setTenant(tx, tenantA, subjectA);
      await tx.staffAvailabilityCheck.update({ where: { id: availabilityCheckA.id }, data: { response: 'AVAILABLE', respondedAt: new Date() } });
      await tx.staffAvailabilityCheckAudit.create({ data: { organizationId: tenantA, availabilityCheckId: availabilityCheckA.id, actorId: subjectA, action: 'available' } });
      await setTenant(tx, tenantA);
      const demandA = await tx.staffingDemand.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, role: 'Usher', startsAt: shiftA.startsAt, endsAt: shiftA.endsAt, requiredHeadcount: 2, createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      demandAId = demandA.id;
      const demandAuditA = await tx.staffingDemandAudit.create({ data: { organizationId: tenantA, demandId: demandA.id, actorId: 'tenant-isolation-test', action: 'created' } });
      demandAuditAId = demandAuditA.id;
      const vendorRequestA = await tx.staffingVendorRequest.create({ data: { organizationId: tenantA, venueId: venueA, eventId: eventA, locationId: locationA, demandId: demandA.id, requesterSubject: 'tenant-isolation-test', vendorSubject: subjectA, requestedHeadcount: 1, responseDueAt: new Date(Date.now() + 86400000) } });
      vendorRequestAId = vendorRequestA.id;
      await tx.staffingVendorRequestAudit.create({ data: { organizationId: tenantA, requestId: vendorRequestA.id, actorId: 'tenant-isolation-test', action: 'sent' } });
      const breakA = await tx.staffBreak.create({ data: { organizationId: tenantA, shiftId: shiftA.id, workerSubject: subjectA, kind: 'REST', startedAt: new Date('2026-10-01T19:00:00Z') } });
      breakAId = breakA.id;
      const claimA = await tx.staffAttendanceClaim.create({ data: { organizationId: tenantA, eventId: eventA, shiftId: shiftA.id, workerSubject: subjectA, action: 'CHECK_OUT', recordedAt: new Date('2026-10-01T22:00:00Z') } });
      attendanceClaimAId = claimA.id;
      await tx.userNotification.create({ data: { organizationId: tenantA, eventId: eventA, shiftId: shiftA.id, recipientSubject: 'tenant-isolation-test', kind: 'staffing.shift.published', title: 'Tenant A shift', body: 'Review shift.' } });
      await tx.userNotification.create({ data: { organizationId: tenantA, eventId: eventA, issueId: issueA.id, recipientSubject: 'tenant-isolation-test', kind: 'issue.assigned', title: 'Tenant A', body: 'Tenant A' } });
      await tx.issueAttachment.create({ data: { organizationId: tenantA, eventId: eventA, issueId: issueA.id, clientId: randomUUID(), uploadedBy: 'tenant-isolation-test', fileName: 'fixture.jpg', contentType: 'image/jpeg', sizeBytes: 1, sha256: 'a'.repeat(64), storageObjectKey: `tenant-a/${randomUUID()}` } });
      const pushTokenA = `tenant-a-push-token-${randomUUID()}-${randomUUID()}`;
      await tx.pushDevice.create({ data: { organizationId: tenantA, subject: 'tenant-isolation-test', installationId: randomUUID(), registrationToken: pushTokenA, tokenSha256: createHash('sha256').update(pushTokenA).digest('hex'), platform: 'ios' } });
      const [stockItemA] = await tx.$queryRaw`INSERT INTO stock_items(organization_id,venue_id,location_id,sku,name,unit,on_hand)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${locationA}::uuid,${`RLS-${randomUUID()}`},'Tenant A transfer fixture','case',8) RETURNING id`;
      const [stockPurchaseOrderA] = await tx.$queryRaw`INSERT INTO stock_purchase_orders(organization_id,venue_id,event_id,location_id,supplier_name,requested_by)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${eventA}::uuid,${locationA}::uuid,'Tenant A Supply','tenant-isolation-test') RETURNING id`;
      stockPurchaseOrderAId = stockPurchaseOrderA.id;
      await tx.$executeRaw`INSERT INTO stock_purchase_order_lines(organization_id,event_id,venue_id,purchase_order_id,item_id,ordered_quantity,received_quantity)
        VALUES (${tenantA}::uuid,${eventA}::uuid,${venueA}::uuid,${stockPurchaseOrderA.id}::uuid,${stockItemA.id}::uuid,4,2)`;
      await tx.$executeRaw`INSERT INTO stock_purchase_order_audit(organization_id,purchase_order_id,actor_id,action)
        VALUES (${tenantA}::uuid,${stockPurchaseOrderA.id}::uuid,'tenant-isolation-test','submitted')`;
      await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,purchase_order_id,actor_id,movement_type,quantity_delta,reason)
        VALUES (${tenantA}::uuid,${stockItemA.id}::uuid,${stockPurchaseOrderA.id}::uuid,'tenant-isolation-test','PURCHASE_RECEIPT',2,'isolation fixture')`;
      const [stockTransferA] = await tx.$queryRaw`INSERT INTO stock_transfers(organization_id,venue_id,event_id,source_location_id,destination_location_id,requested_by)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${eventA}::uuid,${locationA}::uuid,NULL,'tenant-isolation-test') RETURNING id`;
      stockTransferAId = stockTransferA.id;
      await tx.$executeRaw`INSERT INTO stock_transfer_lines(organization_id,transfer_id,source_item_id,requested_quantity)
        VALUES (${tenantA}::uuid,${stockTransferA.id}::uuid,${stockItemA.id}::uuid,2)`;
      await tx.$executeRaw`INSERT INTO stock_transfer_audit(organization_id,transfer_id,actor_id,action)
        VALUES (${tenantA}::uuid,${stockTransferA.id}::uuid,'tenant-isolation-test','requested')`;
      const [stockCountA] = await tx.$queryRaw`INSERT INTO stock_counts(organization_id,venue_id,event_id,location_id,counter_id)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${eventA}::uuid,${locationA}::uuid,'tenant-isolation-test') RETURNING id`;
      stockCountAId = stockCountA.id;
      await tx.$executeRaw`INSERT INTO stock_count_lines(organization_id,count_id,item_id,expected_quantity,counted_quantity)
        VALUES (${tenantA}::uuid,${stockCountA.id}::uuid,${stockItemA.id}::uuid,8,7)`;
      await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,count_id,actor_id,movement_type,quantity_delta,reason)
        VALUES (${tenantA}::uuid,${stockItemA.id}::uuid,${stockCountA.id}::uuid,'tenant-isolation-test','COUNT_ADJUSTMENT',-1,'isolation fixture')`;
      await tx.$executeRaw`INSERT INTO stock_count_audit(organization_id,count_id,actor_id,action)
        VALUES (${tenantA}::uuid,${stockCountA.id}::uuid,'tenant-isolation-test','started')`;
      const [menuItemA] = await tx.$queryRaw`INSERT INTO hospitality_menu_items(organization_id,venue_id,name,category,default_unit,unit_price)
        VALUES (${tenantA}::uuid,${venueA}::uuid,'Tenant A Platter','Food','tray',150.00) RETURNING id`;
      hospitalityMenuItemAId = menuItemA.id;
      const [hospitalityOrderA] = await tx.$queryRaw`INSERT INTO hospitality_orders(organization_id,venue_id,event_id,location_id,requested_by,service_at,beo_reference)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${eventA}::uuid,${locationA}::uuid,'tenant-isolation-test',now(),'BEO-2026-A1') RETURNING id`;
      hospitalityOrderAId = hospitalityOrderA.id;
      const [hospitalityOrderLineA] = await tx.$queryRaw`INSERT INTO hospitality_order_lines(organization_id,order_id,item_name,quantity,unit,menu_item_id)
        VALUES (${tenantA}::uuid,${hospitalityOrderA.id}::uuid,'Water bottles',24,'each',${menuItemA.id}::uuid) RETURNING id`;
      hospitalityOrderLineAId = hospitalityOrderLineA.id;
      await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
        VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderA.id}::uuid,${hospitalityOrderLineAId}::uuid,'tenant-isolation-test',1)`;
      await tx.$executeRaw`INSERT INTO hospitality_order_audit(organization_id,order_id,actor_id,action)
        VALUES (${tenantA}::uuid,${hospitalityOrderA.id}::uuid,'tenant-isolation-test','submitted')`;
      const [closeoutA] = await tx.$queryRaw`INSERT INTO event_closeouts(organization_id,venue_id,event_id,opened_by)
        VALUES (${tenantA}::uuid,${venueA}::uuid,${eventA}::uuid,'tenant-isolation-test') RETURNING id`;
      closeoutAId = closeoutA.id;
      const [closeoutFollowupA] = await tx.$queryRaw`INSERT INTO event_closeout_followups(organization_id,closeout_id,source_type,source_id,title)
        VALUES (${tenantA}::uuid,${closeoutA.id}::uuid,'TASK','fixture-a','Tenant A follow-up') RETURNING id`;
      closeoutFollowupAId = closeoutFollowupA.id;
      await tx.$executeRaw`INSERT INTO event_closeout_audit(organization_id,closeout_id,actor_id,action)
        VALUES (${tenantA}::uuid,${closeoutA.id}::uuid,'tenant-isolation-test','opened')`;

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
      const shiftB = await tx.staffShift.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, assignedSubject: subjectB, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 1, attendance: 'CHECKED_IN', checkedInAt: new Date('2026-10-01T17:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      await tx.staffShiftAuditEvent.create({ data: { organizationId: tenantB, shiftId: shiftB.id, actorId: 'tenant-isolation-test', action: 'created' } });
      const availabilityShiftB = await tx.staffShift.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, role: 'Availability fixture', startsAt: new Date('2026-10-02T17:00:00Z'), endsAt: new Date('2026-10-02T22:00:00Z'), createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      const availabilityCheckB = await tx.staffAvailabilityCheck.create({ data: { organizationId: tenantB, eventId: eventB, shiftId: availabilityShiftB.id, workerSubject: subjectB, shiftRevision: 1, requestedBy: 'tenant-isolation-test' } });
      availabilityCheckBId = availabilityCheckB.id;
      await tx.staffAvailabilityCheckAudit.create({ data: { organizationId: tenantB, availabilityCheckId: availabilityCheckB.id, actorId: 'tenant-isolation-test', action: 'requested' } });
      const demandB = await tx.staffingDemand.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, role: 'Usher', startsAt: shiftB.startsAt, endsAt: shiftB.endsAt, requiredHeadcount: 2, createdBy: 'tenant-isolation-test', updatedBy: 'tenant-isolation-test' } });
      demandBId = demandB.id;
      const demandAuditB = await tx.staffingDemandAudit.create({ data: { organizationId: tenantB, demandId: demandB.id, actorId: 'tenant-isolation-test', action: 'created' } });
      demandAuditBId = demandAuditB.id;
      const vendorRequestB = await tx.staffingVendorRequest.create({ data: { organizationId: tenantB, venueId: venueB, eventId: eventB, locationId: locationB, demandId: demandB.id, requesterSubject: 'tenant-isolation-test', vendorSubject: subjectB, requestedHeadcount: 1, responseDueAt: new Date(Date.now() + 86400000) } });
      vendorRequestBId = vendorRequestB.id;
      await tx.staffingVendorRequestAudit.create({ data: { organizationId: tenantB, requestId: vendorRequestB.id, actorId: 'tenant-isolation-test', action: 'sent' } });
      const breakB = await tx.staffBreak.create({ data: { organizationId: tenantB, shiftId: shiftB.id, workerSubject: subjectB, kind: 'MEAL', startedAt: new Date('2026-10-01T19:00:00Z') } });
      breakBId = breakB.id;
      const claimB = await tx.staffAttendanceClaim.create({ data: { organizationId: tenantB, eventId: eventB, shiftId: shiftB.id, workerSubject: subjectB, action: 'CHECK_OUT', recordedAt: new Date('2026-10-01T22:00:00Z') } });
      attendanceClaimBId = claimB.id;
      await tx.userNotification.create({ data: { organizationId: tenantB, eventId: eventB, shiftId: shiftB.id, recipientSubject: 'tenant-isolation-test', kind: 'staffing.shift.published', title: 'Tenant B shift', body: 'Review shift.' } });
      await tx.userNotification.create({ data: { organizationId: tenantB, eventId: eventB, issueId: issueB.id, recipientSubject: 'tenant-isolation-test', kind: 'issue.assigned', title: 'Tenant B', body: 'Tenant B' } });
      await tx.issueAttachment.create({ data: { organizationId: tenantB, eventId: eventB, issueId: issueB.id, clientId: randomUUID(), uploadedBy: 'tenant-isolation-test', fileName: 'fixture.jpg', contentType: 'image/jpeg', sizeBytes: 1, sha256: 'b'.repeat(64), storageObjectKey: `tenant-b/${randomUUID()}` } });
      const pushTokenB = `tenant-b-push-token-${randomUUID()}-${randomUUID()}`;
      await tx.pushDevice.create({ data: { organizationId: tenantB, subject: 'tenant-isolation-test', installationId: randomUUID(), registrationToken: pushTokenB, tokenSha256: createHash('sha256').update(pushTokenB).digest('hex'), platform: 'android' } });
      const [stockItemB] = await tx.$queryRaw`INSERT INTO stock_items(organization_id,venue_id,location_id,sku,name,unit,on_hand)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${locationB}::uuid,${`RLS-${randomUUID()}`},'Tenant B transfer fixture','case',6) RETURNING id`;
      const [stockPurchaseOrderB] = await tx.$queryRaw`INSERT INTO stock_purchase_orders(organization_id,venue_id,event_id,location_id,supplier_name,requested_by)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,'Tenant B Supply','tenant-isolation-test') RETURNING id`;
      stockPurchaseOrderBId = stockPurchaseOrderB.id;
      await tx.$executeRaw`INSERT INTO stock_purchase_order_lines(organization_id,event_id,venue_id,purchase_order_id,item_id,ordered_quantity)
        VALUES (${tenantB}::uuid,${eventB}::uuid,${venueB}::uuid,${stockPurchaseOrderB.id}::uuid,${stockItemB.id}::uuid,6)`;
      await tx.$executeRaw`INSERT INTO stock_purchase_order_audit(organization_id,purchase_order_id,actor_id,action)
        VALUES (${tenantB}::uuid,${stockPurchaseOrderB.id}::uuid,'tenant-isolation-test','submitted')`;
      await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,purchase_order_id,actor_id,movement_type,quantity_delta,reason)
        VALUES (${tenantB}::uuid,${stockItemB.id}::uuid,${stockPurchaseOrderB.id}::uuid,'tenant-isolation-test','PURCHASE_RECEIPT',1,'isolation fixture')`;
      const [stockTransferB] = await tx.$queryRaw`INSERT INTO stock_transfers(organization_id,venue_id,event_id,source_location_id,destination_location_id,requested_by)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,NULL,'tenant-isolation-test') RETURNING id`;
      stockTransferBId = stockTransferB.id;
      await tx.$executeRaw`INSERT INTO stock_transfer_lines(organization_id,transfer_id,source_item_id,requested_quantity)
        VALUES (${tenantB}::uuid,${stockTransferB.id}::uuid,${stockItemB.id}::uuid,3)`;
      await tx.$executeRaw`INSERT INTO stock_transfer_audit(organization_id,transfer_id,actor_id,action)
        VALUES (${tenantB}::uuid,${stockTransferB.id}::uuid,'tenant-isolation-test','requested')`;
      const [stockCountB] = await tx.$queryRaw`INSERT INTO stock_counts(organization_id,venue_id,event_id,location_id,counter_id)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,'tenant-isolation-test') RETURNING id`;
      stockCountBId = stockCountB.id;
      await tx.$executeRaw`INSERT INTO stock_count_lines(organization_id,count_id,item_id,expected_quantity,counted_quantity)
        VALUES (${tenantB}::uuid,${stockCountB.id}::uuid,${stockItemB.id}::uuid,6,5)`;
      await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,count_id,actor_id,movement_type,quantity_delta,reason)
        VALUES (${tenantB}::uuid,${stockItemB.id}::uuid,${stockCountB.id}::uuid,'tenant-isolation-test','COUNT_ADJUSTMENT',-1,'isolation fixture')`;
      await tx.$executeRaw`INSERT INTO stock_count_audit(organization_id,count_id,actor_id,action)
        VALUES (${tenantB}::uuid,${stockCountB.id}::uuid,'tenant-isolation-test','started')`;
      const [menuItemB] = await tx.$queryRaw`INSERT INTO hospitality_menu_items(organization_id,venue_id,name,category,default_unit,unit_price)
        VALUES (${tenantB}::uuid,${venueB}::uuid,'Tenant B Drinks','Beverage','case',75.00) RETURNING id`;
      hospitalityMenuItemBId = menuItemB.id;
      const [hospitalityOrderB] = await tx.$queryRaw`INSERT INTO hospitality_orders(organization_id,venue_id,event_id,location_id,requested_by,service_at,beo_reference)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,'tenant-isolation-test',now(),'BEO-2026-B1') RETURNING id`;
      hospitalityOrderBId = hospitalityOrderB.id;
      const [hospitalityOrderLineB] = await tx.$queryRaw`INSERT INTO hospitality_order_lines(organization_id,order_id,item_name,quantity,unit,menu_item_id)
        VALUES (${tenantB}::uuid,${hospitalityOrderB.id}::uuid,'Water bottles',18,'each',${menuItemB.id}::uuid) RETURNING id`;
      hospitalityOrderLineBId = hospitalityOrderLineB.id;
      await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
        VALUES (${tenantB}::uuid,${eventB}::uuid,${hospitalityOrderB.id}::uuid,${hospitalityOrderLineBId}::uuid,'tenant-isolation-test',1)`;
      await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
        VALUES (${tenantB}::uuid,${eventB}::uuid,${hospitalityOrderB.id}::uuid,${hospitalityOrderLineBId}::uuid,'tenant-isolation-test',17)`;
      await tx.$executeRaw`UPDATE hospitality_orders SET state='DISTRIBUTED' WHERE id=${hospitalityOrderB.id}::uuid`;
      await tx.$executeRaw`INSERT INTO hospitality_delivery_receipts(organization_id,event_id,order_id,actor_id,received_by_name,receiver_acknowledged)
        VALUES (${tenantB}::uuid,${eventB}::uuid,${hospitalityOrderB.id}::uuid,'tenant-isolation-test','Gate lead',true)`;
      await tx.$executeRaw`INSERT INTO hospitality_order_audit(organization_id,order_id,actor_id,action)
        VALUES (${tenantB}::uuid,${hospitalityOrderB.id}::uuid,'tenant-isolation-test','submitted')`;
      const [closeoutB] = await tx.$queryRaw`INSERT INTO event_closeouts(organization_id,venue_id,event_id,opened_by)
        VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,'tenant-isolation-test') RETURNING id`;
      closeoutBId = closeoutB.id;
      const [closeoutFollowupB] = await tx.$queryRaw`INSERT INTO event_closeout_followups(organization_id,closeout_id,source_type,source_id,title)
        VALUES (${tenantB}::uuid,${closeoutB.id}::uuid,'TASK','fixture-b','Tenant B follow-up') RETURNING id`;
      closeoutFollowupBId = closeoutFollowupB.id;
      await tx.$executeRaw`INSERT INTO event_closeout_audit(organization_id,closeout_id,actor_id,action)
        VALUES (${tenantB}::uuid,${closeoutB.id}::uuid,'tenant-isolation-test','opened')`;

      await setTenant(tx, tenantA);
      assert.equal(await tx.userNotification.count({ where: { organizationId: tenantA, shiftId: shiftA.id, recipientSubject: 'tenant-isolation-test' } }), 1, 'the assigned worker can read the shift notification');
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees only its availability records');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its person qualifications');
      assert.equal(await tx.staffBreak.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its shift break evidence');
      assert.equal(await tx.staffAttendanceClaim.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its pending attendance claims');
      assert.equal(await tx.staffingDemand.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its staffing demand');
      assert.equal(await tx.staffingDemandAudit.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its staffing demand audit');
      assert.equal(await tx.staffingVendorRequest.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its vendor request');
      assert.equal(await tx.staffingVendorRequestAudit.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its vendor request audit');
      assert.equal(await tx.staffAvailabilityCheck.count({ where: { organizationId: tenantA } }), 1, 'tenant A sees its explicit worker availability response');
      assert.equal(await tx.staffAvailabilityCheckAudit.count({ where: { organizationId: tenantA } }), 2, 'tenant A sees the immutable availability request and response audit');
      await tx.$executeRawUnsafe('SAVEPOINT vendor_request_rls_insert_probe');
      let crossTenantVendorRequestError;
      try {
        await tx.$executeRaw`INSERT INTO staffing_vendor_requests(organization_id,venue_id,event_id,location_id,demand_id,requester_subject,vendor_subject,requested_headcount,response_due_at)
          VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,${demandBId}::uuid,'forbidden-cross-tenant',${subjectB},1,now()+interval '1 day')`;
      } catch (error) { crossTenantVendorRequestError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT vendor_request_rls_insert_probe');
      assert.equal(crossTenantVendorRequestError?.meta?.code, '42501', 'cross-tenant vendor request insert must fail RLS WITH CHECK');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfers WHERE id=${stockTransferAId}::uuid`)[0].count, 1, 'tenant A sees its stock transfer');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_lines WHERE transfer_id=${stockTransferAId}::uuid`)[0].count, 1, 'tenant A sees its transfer lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_audit WHERE transfer_id=${stockTransferAId}::uuid`)[0].count, 1, 'tenant A sees its transfer audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_counts WHERE id=${stockCountAId}::uuid`)[0].count, 1, 'tenant A sees its stock count');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_lines WHERE count_id=${stockCountAId}::uuid`)[0].count, 1, 'tenant A sees its count lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE count_id=${stockCountAId}::uuid`)[0].count, 1, 'tenant A sees its inventory movements');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_audit WHERE count_id=${stockCountAId}::uuid`)[0].count, 1, 'tenant A sees its count audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_orders WHERE id=${stockPurchaseOrderAId}::uuid`)[0].count, 1, 'tenant A sees its purchase order');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_order_lines WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 1, 'tenant A sees its purchase order lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_order_audit WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 1, 'tenant A sees its purchase order audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 1, 'tenant A sees its receipt movement');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_orders WHERE id=${hospitalityOrderAId}::uuid`)[0].count, 1, 'tenant A sees its hospitality order');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_lines WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 1, 'tenant A sees its hospitality order lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_fulfillments WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 1, 'tenant A sees immutable hospitality fulfillment records');
      assert.equal(Number((await tx.$queryRaw`SELECT fulfilled_quantity FROM hospitality_order_lines WHERE order_id=${hospitalityOrderAId}::uuid`)[0].fulfilled_quantity), 1, 'fulfillment trigger maintains the delivered quantity total');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_audit WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 1, 'tenant A sees its hospitality order audit');
      await tx.$executeRawUnsafe('SAVEPOINT hospitality_overdelivery_probe');
      let hospitalityOverdeliveryError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
          VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,${hospitalityOrderLineAId}::uuid,'tenant-isolation-test',24)`;
      } catch (error) { hospitalityOverdeliveryError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hospitality_overdelivery_probe');
      assert.equal(hospitalityOverdeliveryError?.meta?.code, '23514', 'the database must reject hospitality quantities above the order line amount');
      await tx.$executeRawUnsafe('SAVEPOINT cross_tenant_hospitality_fulfillment_probe');
      let crossTenantHospitalityFulfillmentError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
          VALUES (${tenantB}::uuid,${eventB}::uuid,${hospitalityOrderBId}::uuid,${hospitalityOrderLineBId}::uuid,'tenant-isolation-test',1)`;
      } catch (error) { crossTenantHospitalityFulfillmentError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cross_tenant_hospitality_fulfillment_probe');
      assert.ok(crossTenantHospitalityFulfillmentError, 'runtime role must not insert another tenant hospitality fulfillment');
      assert.ok(['23503', '42501'].includes(crossTenantHospitalityFulfillmentError.meta?.code), 'cross-tenant hospitality fulfillment must fail closed through forced RLS or the quantity guard');
      await tx.$executeRawUnsafe('SAVEPOINT premature_hospitality_receipt_probe');
      let prematureHospitalityReceiptError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_delivery_receipts(organization_id,event_id,order_id,actor_id,received_by_name,receiver_acknowledged)
          VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,'tenant-isolation-test','Suite host',true)`;
      } catch (error) { prematureHospitalityReceiptError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT premature_hospitality_receipt_probe');
      assert.equal(prematureHospitalityReceiptError?.meta?.code, '23514', 'database requires all hospitality items delivered before handoff receipt');
      await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
        VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,${hospitalityOrderLineAId}::uuid,'tenant-isolation-test',23)`;
      await tx.$executeRaw`UPDATE hospitality_orders SET state='DISTRIBUTED' WHERE id=${hospitalityOrderAId}::uuid`;
      await tx.$executeRaw`INSERT INTO hospitality_delivery_receipts(organization_id,event_id,order_id,actor_id,received_by_name,receiver_acknowledged)
        VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,'tenant-isolation-test','Suite host',true)`;
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_delivery_receipts WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 1, 'tenant A sees its immutable hospitality handoff receipt');
      await tx.$executeRawUnsafe('SAVEPOINT cross_tenant_hospitality_receipt_probe');
      let crossTenantHospitalityReceiptError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_delivery_receipts(organization_id,event_id,order_id,actor_id,received_by_name,receiver_acknowledged)
          VALUES (${tenantB}::uuid,${eventB}::uuid,${hospitalityOrderBId}::uuid,'tenant-isolation-test','Gate lead',true)`;
      } catch (error) { crossTenantHospitalityReceiptError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cross_tenant_hospitality_receipt_probe');
      assert.ok(crossTenantHospitalityReceiptError, 'runtime role must not insert another tenant delivery receipt');
      assert.ok(['23514', '23503', '42501'].includes(crossTenantHospitalityReceiptError.meta?.code), 'cross-tenant hospitality receipt must fail closed through the fulfillment guard, foreign key, or RLS');
      await tx.$executeRawUnsafe('SAVEPOINT immutable_hospitality_receipt_probe');
      let immutableHospitalityReceiptError;
      try {
        await tx.$executeRaw`UPDATE hospitality_delivery_receipts SET note='rewritten' WHERE order_id=${hospitalityOrderAId}::uuid`;
      } catch (error) { immutableHospitalityReceiptError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_hospitality_receipt_probe');
      assert.ok(['42501', 'P0001'].includes(immutableHospitalityReceiptError?.meta?.code), 'runtime role cannot rewrite a hospitality handoff receipt');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeouts WHERE id=${closeoutAId}::uuid`)[0].count, 1, 'tenant A sees its event closeout');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_followups WHERE closeout_id=${closeoutAId}::uuid`)[0].count, 1, 'tenant A sees its closeout follow-up');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_audit WHERE closeout_id=${closeoutAId}::uuid`)[0].count, 1, 'tenant A sees its closeout audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_menu_items WHERE id=${hospitalityMenuItemAId}::uuid`)[0].count, 1, 'tenant A sees its hospitality menu item');
      await tx.$executeRawUnsafe('SAVEPOINT menu_item_rls_insert_probe');
      let crossTenantMenuItemError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_menu_items(organization_id,venue_id,name,category,default_unit,unit_price)
          VALUES (${tenantB}::uuid,${venueB}::uuid,'Cross Tenant Food','Food','tray',50.00)`;
      } catch (error) { crossTenantMenuItemError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT menu_item_rls_insert_probe');
      assert.equal(crossTenantMenuItemError?.meta?.code, '42501', 'cross-tenant menu item insert must fail RLS WITH CHECK');
      assert.equal((await tx.$executeRaw`UPDATE stock_transfers SET request_note='cross tenant write' WHERE id=${stockTransferBId}::uuid`), 0, 'tenant A cannot update tenant B transfers');
      await tx.$executeRawUnsafe('SAVEPOINT stock_transfer_rls_insert_probe');
      let crossTenantInsertError;
      try {
        await tx.$executeRaw`INSERT INTO stock_transfers(organization_id,venue_id,event_id,source_location_id,destination_location_id,requested_by)
          VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,${locationB}::uuid,NULL,'forbidden-cross-tenant-insert')`;
      } catch (error) {
        crossTenantInsertError = error;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stock_transfer_rls_insert_probe');
      assert.ok(crossTenantInsertError, 'tenant A cross-tenant transfer insert must fail RLS WITH CHECK');
      assert.equal(crossTenantInsertError.meta?.code, '42501', 'cross-tenant transfer insert must fail with PostgreSQL insufficient_privilege');
      await tx.$executeRawUnsafe('SAVEPOINT closeout_rls_insert_probe');
      let crossTenantCloseoutError;
      try {
        await tx.$executeRaw`INSERT INTO event_closeouts(organization_id,venue_id,event_id,opened_by)
          VALUES (${tenantB}::uuid,${venueB}::uuid,${eventB}::uuid,'forbidden-cross-tenant-closeout')`;
      } catch (error) {
        crossTenantCloseoutError = error;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closeout_rls_insert_probe');
      assert.ok(crossTenantCloseoutError, 'tenant A cross-tenant closeout insert must fail RLS WITH CHECK');
      assert.equal(crossTenantCloseoutError.meta?.code, '42501', 'cross-tenant closeout insert must fail with PostgreSQL insufficient_privilege');
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
      assert.ok(auditA.items.some((row) => row.resourceId === closeoutAId && row.resourceType === 'event_closeout'));
      assert.equal(auditA.items.some((row) => row.resourceId === issueB.id || row.resourceId === taskB.id || row.resourceId === closeoutBId || row.id === setupAuditB.id), false, 'tenant A audit feed must exclude tenant B records');

      const auditB = await auditService.list({
        subject: 'tenant-isolation-test',
        tenantId: tenantB,
        capabilities: ['tenant:admin'],
        venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [],
      }, '100');
      assert.ok(auditB.items.some((row) => row.resourceId === issueB.id && row.resourceType === 'issue'));
      assert.ok(auditB.items.some((row) => row.resourceId === taskB.id && row.resourceType === 'task'));
      assert.ok(auditB.items.some((row) => row.id === setupAuditB.id && row.resourceType === 'venue'));
      assert.ok(auditB.items.some((row) => row.resourceId === closeoutBId && row.resourceType === 'event_closeout'));
      assert.equal(auditB.items.some((row) => row.resourceId === issueA.id || row.resourceId === taskA.id || row.resourceId === closeoutAId || row.id === setupAuditA.id), false, 'tenant B audit feed must exclude tenant A records');

      await setTenant(tx, tenantA);
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B availability');
      assert.equal(await tx.staffUnavailabilityAudit.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B availability audit');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B qualifications');
      assert.equal(await tx.staffBreak.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B break evidence');
      assert.equal(await tx.staffAttendanceClaim.count({ where: { organizationId: tenantB } }), 0, 'tenant A cannot read tenant B attendance claims');
      await assertTenantCannotRead(tx, tenantA, tenantB, issueB.id, taskB.id, shiftB.id, breakBId, attendanceClaimBId, demandBId, demandAuditBId, stockTransferBId, stockCountBId, hospitalityOrderBId, closeoutBId);
      const updated = await tx.issue.updateMany({ where: { id: issueB.id }, data: { title: 'forbidden update' } });
      const deleted = await tx.issue.deleteMany({ where: { id: issueB.id } });
      const updatedTask = await tx.operationalTask.updateMany({ where: { id: taskB.id }, data: { title: 'forbidden update' } });
      const updatedShift = await tx.staffShift.updateMany({ where: { id: shiftB.id }, data: { role: 'forbidden update' } });
      const updatedBreak = await tx.staffBreak.updateMany({ where: { id: breakBId }, data: { workerSubject: subjectA } });
      const updatedClaim = await tx.staffAttendanceClaim.updateMany({ where: { id: attendanceClaimBId }, data: { workerSubject: subjectA } });
      const updatedDemand = await tx.staffingDemand.updateMany({ where: { id: demandBId }, data: { requiredHeadcount: 9 } });
      const updatedAvailability = await tx.staffAvailabilityCheck.updateMany({ where: { id: availabilityCheckBId }, data: { response: 'AVAILABLE', respondedAt: new Date() } });
      assert.equal(updated.count, 0, 'tenant A must not update tenant B issues');
      assert.equal(deleted.count, 0, 'tenant A must not delete tenant B issues');
      assert.equal(updatedTask.count, 0, 'tenant A must not update tenant B operational tasks');
      assert.equal(updatedShift.count, 0, 'tenant A must not update tenant B staff shifts');
      assert.equal(updatedBreak.count, 0, 'tenant A must not update tenant B break evidence');
      assert.equal(updatedClaim.count, 0, 'tenant A must not update tenant B attendance claims');
      assert.equal(updatedDemand.count, 0, 'tenant A must not update tenant B staffing demands');
      assert.equal(updatedAvailability.count, 0, 'tenant A must not update tenant B availability responses');

      await setTenant(tx, tenantB);
      assert.equal(await tx.staffUnavailability.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability');
      assert.equal(await tx.staffUnavailabilityAudit.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability audit');
      assert.equal(await tx.personQualification.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A qualifications');
      assert.equal(await tx.staffBreak.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A break evidence');
      assert.equal(await tx.staffAttendanceClaim.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A attendance claims');
      assert.equal(await tx.staffingDemand.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A staffing demands');
      assert.equal(await tx.staffingDemandAudit.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A staffing demand audit');
      assert.equal(await tx.staffAvailabilityCheck.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability responses');
      assert.equal(await tx.staffAvailabilityCheckAudit.count({ where: { organizationId: tenantA } }), 0, 'tenant B cannot read tenant A availability audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_items WHERE organization_id=${tenantB}::uuid`)[0].count, 1, 'tenant B sees its stock catalog item');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_counts WHERE id=${stockCountBId}::uuid`)[0].count, 1, 'tenant B sees its stock count');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_lines WHERE count_id=${stockCountBId}::uuid`)[0].count, 1, 'tenant B sees its stock count line');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE count_id=${stockCountBId}::uuid`)[0].count, 1, 'tenant B sees its stock movement');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_audit WHERE count_id=${stockCountBId}::uuid`)[0].count, 1, 'tenant B sees its stock count audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_orders WHERE id=${hospitalityOrderBId}::uuid`)[0].count, 1, 'tenant B sees its hospitality order');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_lines WHERE order_id=${hospitalityOrderBId}::uuid`)[0].count, 1, 'tenant B sees its hospitality order line');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_fulfillments WHERE order_id=${hospitalityOrderBId}::uuid`)[0].count, 2, 'tenant B sees both hospitality fulfillment records');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_audit WHERE order_id=${hospitalityOrderBId}::uuid`)[0].count, 1, 'tenant B sees its hospitality order audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeouts WHERE id=${closeoutBId}::uuid`)[0].count, 1, 'tenant B sees its event closeout');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_followups WHERE closeout_id=${closeoutBId}::uuid`)[0].count, 1, 'tenant B sees its closeout follow-up');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_audit WHERE closeout_id=${closeoutBId}::uuid`)[0].count, 1, 'tenant B sees its closeout audit');
      assert.equal(await tx.staffingVendorRequest.count({ where: { organizationId: tenantB } }), 1, 'tenant B sees its vendor request');
      assert.equal(await tx.staffingVendorRequestAudit.count({ where: { organizationId: tenantB } }), 1, 'tenant B sees its vendor request audit');
      assert.equal((await tx.staffingVendorRequest.count({ where: { id: vendorRequestAId } })), 0, 'tenant B cannot read tenant A vendor request');
      assert.equal((await tx.staffingVendorRequestAudit.count({ where: { requestId: vendorRequestAId } })), 0, 'tenant B cannot read tenant A vendor request audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfers WHERE id=${stockTransferAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A stock transfers');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_lines WHERE transfer_id=${stockTransferAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A transfer lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_audit WHERE transfer_id=${stockTransferAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A transfer audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_counts WHERE id=${stockCountAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A stock counts');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_lines WHERE count_id=${stockCountAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A stock count lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE count_id=${stockCountAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A stock movements');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_audit WHERE count_id=${stockCountAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A stock count audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_orders WHERE id=${stockPurchaseOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A purchase order');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_order_lines WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A purchase order lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_order_audit WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A purchase order audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE purchase_order_id=${stockPurchaseOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A receipt movement');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_orders WHERE id=${stockPurchaseOrderBId}::uuid`)[0].count, 1, 'tenant B sees its own purchase order');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_orders WHERE id=${hospitalityOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A hospitality orders');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_lines WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A hospitality order lines');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_fulfillments WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A fulfillment records');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_delivery_receipts WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A delivery receipts');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_delivery_receipts WHERE order_id=${hospitalityOrderBId}::uuid`)[0].count, 1, 'tenant B sees its own hospitality delivery receipt');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_menu_items WHERE id=${hospitalityMenuItemBId}::uuid`)[0].count, 1, 'tenant B sees its own hospitality menu item');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_menu_items WHERE id=${hospitalityMenuItemAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A hospitality menu items');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_audit WHERE order_id=${hospitalityOrderAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A hospitality order audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeouts WHERE id=${closeoutAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A event closeout');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_followups WHERE id=${closeoutFollowupAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A closeout follow-up');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_audit WHERE closeout_id=${closeoutAId}::uuid`)[0].count, 0, 'tenant B cannot read tenant A closeout audit');
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_post_close_corrections WHERE event_id=${eventA}::uuid`)[0].count, 0, 'tenant B cannot read tenant A post-close corrections');
      await assertTenantCannotRead(tx, tenantB, tenantA, issueA.id, taskA.id, shiftA.id, breakAId, attendanceClaimAId, demandAId, demandAuditAId, stockTransferAId, stockCountAId, hospitalityOrderAId, closeoutAId);
      await setTenant(tx, tenantB, 'unrelated-recipient');
      assert.equal(await tx.userNotification.count({ where: { organizationId: tenantB } }), 0, 'notifications must only be visible to their recipient subject');
      assert.equal(await tx.pushDevice.count({ where: { organizationId: tenantB } }), 0, 'push tokens must only be visible to their registered subject');
      await setTenant(tx, tenantA);
      await tx.$executeRawUnsafe('SAVEPOINT closed_event_write_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      let closedEventWriteError;
      try {
        await tx.$executeRaw`UPDATE operational_tasks SET title='forbidden closed-event edit' WHERE id=${taskA.id}::uuid`;
      } catch (error) {
        closedEventWriteError = error;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed_event_write_probe');
      assert.equal(closedEventWriteError?.meta?.code, '23514', 'ordinary operational writes must be rejected after closeout finalization');
      await tx.$executeRawUnsafe('SAVEPOINT closed_vendor_request_write_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      let closedVendorRequestWriteError;
      try {
        await tx.$executeRaw`UPDATE staffing_vendor_requests SET instructions='forbidden post-close edit' WHERE id=${vendorRequestAId}::uuid`;
      } catch (error) { closedVendorRequestWriteError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed_vendor_request_write_probe');
      assert.equal(closedVendorRequestWriteError?.meta?.code, '23514', 'vendor requests must also be immutable after event closeout');
      await tx.$executeRawUnsafe('SAVEPOINT closed_event_child_write_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      let closedEventChildWriteError;
      try {
        await tx.$executeRaw`UPDATE stock_count_lines SET note='forbidden closed-event stock edit' WHERE count_id=${stockCountAId}::uuid`;
      } catch (error) {
        closedEventChildWriteError = error;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed_event_child_write_probe');
      assert.equal(closedEventChildWriteError?.meta?.code, '23514', 'inventory detail writes must be rejected after closeout finalization');
      await tx.$executeRawUnsafe('SAVEPOINT closed_hospitality_fulfillment_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      let closedHospitalityFulfillmentError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_order_fulfillments(organization_id,event_id,order_id,line_id,actor_id,quantity)
          SELECT ${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,id,'tenant-isolation-test',1
          FROM hospitality_order_lines WHERE order_id=${hospitalityOrderAId}::uuid`;
      } catch (error) { closedHospitalityFulfillmentError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed_hospitality_fulfillment_probe');
      assert.equal(closedHospitalityFulfillmentError?.meta?.code, '23514', 'hospitality fulfillment writes must be rejected after closeout finalization');
      await tx.$executeRawUnsafe('SAVEPOINT closed_hospitality_receipt_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      let closedHospitalityReceiptError;
      try {
        await tx.$executeRaw`INSERT INTO hospitality_delivery_receipts(organization_id,event_id,order_id,actor_id,received_by_name,receiver_acknowledged)
          VALUES (${tenantA}::uuid,${eventA}::uuid,${hospitalityOrderAId}::uuid,'tenant-isolation-test','Another host',true)`;
      } catch (error) { closedHospitalityReceiptError = error; }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT closed_hospitality_receipt_probe');
      assert.equal(closedHospitalityReceiptError?.meta?.code, '23514', 'handoff receipts must be rejected after event closeout');
      await tx.$executeRawUnsafe('SAVEPOINT post_close_correction_rls_probe');
      await tx.$executeRaw`UPDATE event_closeouts SET state='CLOSED',finalized_by='tenant-isolation-test',finalized_at=now() WHERE id=${closeoutAId}::uuid`;
      const [correctionA] = await tx.$queryRaw`INSERT INTO event_post_close_corrections(organization_id,event_id,source_type,source_id,headline,correction,reason,created_by)
        VALUES (${tenantA}::uuid,${eventA}::uuid,'EVENT',${eventA},'Post-close correction','Verified event record addendum.','Checked against the signed supervisor log.','tenant-isolation-test') RETURNING id`;
      await setTenant(tx, tenantB);
      assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_post_close_corrections WHERE id=${correctionA.id}::uuid`)[0].count, 0, 'tenant B cannot read tenant A post-close correction');
      await setTenant(tx, tenantA);
      let immutableCorrectionError;
      try {
        await tx.$executeRaw`UPDATE event_post_close_corrections SET headline='forbidden rewrite' WHERE id=${correctionA.id}::uuid`;
      } catch (error) { immutableCorrectionError = error; }
      assert.equal(immutableCorrectionError?.meta?.code, 'P0001', 'post-close corrections must be immutable');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT post_close_correction_rls_probe');
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

  process.stdout.write('Tenant isolation passed: reads, updates, deletes, inserts, closeout write lock, append-only corrections, audit/event/device visibility, and location-to-venue integrity.\n');
} finally {
  await prisma.$disconnect();
}

async function assertTenantCannotRead(tx, visibleTenant, hiddenTenant, hiddenIssueId, hiddenTaskId, hiddenShiftId, hiddenBreakId, hiddenAttendanceClaimId, hiddenDemandId, hiddenDemandAuditId, hiddenStockTransferId, hiddenStockCountId, hiddenHospitalityOrderId, hiddenCloseoutId) {
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
  assert.equal(await tx.staffBreak.count({ where: { id: hiddenBreakId } }), 0, `${visibleTenant} staff break isolation`);
  assert.equal(await tx.staffAttendanceClaim.count({ where: { id: hiddenAttendanceClaimId } }), 0, `${visibleTenant} offline attendance claim isolation`);
  assert.equal(await tx.staffingDemand.count({ where: { id: hiddenDemandId } }), 0, `${visibleTenant} staffing demand isolation`);
  assert.equal(await tx.staffingDemandAudit.count({ where: { id: hiddenDemandAuditId } }), 0, `${visibleTenant} staffing demand audit isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_items WHERE organization_id=${hiddenTenant}::uuid`)[0].count, 0, `${visibleTenant} stock catalog isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfers WHERE id=${hiddenStockTransferId}::uuid`)[0].count, 0, `${visibleTenant} stock transfer isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_lines WHERE transfer_id=${hiddenStockTransferId}::uuid`)[0].count, 0, `${visibleTenant} stock transfer line isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_transfer_audit WHERE transfer_id=${hiddenStockTransferId}::uuid`)[0].count, 0, `${visibleTenant} stock transfer audit isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_counts WHERE id=${hiddenStockCountId}::uuid`)[0].count, 0, `${visibleTenant} stock count isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_lines WHERE count_id=${hiddenStockCountId}::uuid`)[0].count, 0, `${visibleTenant} stock count line isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_movements WHERE count_id=${hiddenStockCountId}::uuid`)[0].count, 0, `${visibleTenant} stock movement isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_count_audit WHERE count_id=${hiddenStockCountId}::uuid`)[0].count, 0, `${visibleTenant} stock count audit isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_orders WHERE id=${hiddenHospitalityOrderId}::uuid`)[0].count, 0, `${visibleTenant} hospitality order isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_lines WHERE order_id=${hiddenHospitalityOrderId}::uuid`)[0].count, 0, `${visibleTenant} hospitality line isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_menu_items WHERE organization_id=${hiddenTenant}::uuid`)[0].count, 0, `${visibleTenant} hospitality menu items isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_fulfillments WHERE order_id=${hiddenHospitalityOrderId}::uuid`)[0].count, 0, `${visibleTenant} hospitality fulfillment isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM hospitality_order_audit WHERE order_id=${hiddenHospitalityOrderId}::uuid`)[0].count, 0, `${visibleTenant} hospitality audit isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeouts WHERE id=${hiddenCloseoutId}::uuid`)[0].count, 0, `${visibleTenant} event closeout isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_followups WHERE closeout_id=${hiddenCloseoutId}::uuid`)[0].count, 0, `${visibleTenant} closeout follow-up isolation`);
  assert.equal((await tx.$queryRaw`SELECT count(*)::int AS count FROM event_closeout_audit WHERE closeout_id=${hiddenCloseoutId}::uuid`)[0].count, 0, `${visibleTenant} closeout audit isolation`);
}
