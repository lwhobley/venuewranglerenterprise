import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.VENUE_API_URL ?? 'http://127.0.0.1:3000';
const streamBaseUrl = process.env.VENUE_STREAM_API_URL ?? baseUrl;
const token = process.env.VENUE_DEV_TOKEN;
assert.ok(token, 'Set VENUE_DEV_TOKEN using scripts/create-local-dev-token.mjs');

const eventId = '20000000-0000-4000-8000-000000000001';
const venueId = '10000000-0000-4000-8000-000000000001';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const key = () => randomUUID();

async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

const reportKey = key();
const reportBody = {
  title: `Integration issue ${randomUUID().slice(0, 8)}`,
  description: 'Refrigeration display reports a temperature warning.',
  category: 'Service',
  severity: 'HIGH',
  venueId,
  locationId: '30000000-0000-4000-8000-000000000001',
};
const created = await request(`/api/v1/events/${eventId}/issues`, { method: 'POST', body: reportBody, idempotencyKey: reportKey });
assert.equal(created.status, 201);
const issueId = created.data.issue.id;

const streamResponse = await fetch(`${streamBaseUrl}/api/v1/events/${eventId}/issues/stream`, {
  headers: { ...headers, 'Last-Event-ID': '0' },
  signal: AbortSignal.timeout(15000),
});
assert.equal(streamResponse.status, 200);
assert.match(streamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
const reader = streamResponse.body.getReader();
const decoder = new TextDecoder();
let pendingFrame = '';
let replayedEvent;
while (!replayedEvent) {
  const { done, value } = await reader.read();
  assert.equal(done, false, 'the durable issue stream must stay open while replaying events');
  pendingFrame += decoder.decode(value, { stream: true });
  let separator;
  while ((separator = pendingFrame.search(/\r?\n\r?\n/)) >= 0) {
    const frame = pendingFrame.slice(0, separator);
    pendingFrame = pendingFrame.slice(separator).replace(/^\r?\n\r?\n/, '');
    const eventId = frame.match(/^id:\s*(\d+)$/m)?.[1];
    const data = frame.match(/^data:\s*(.+)$/m)?.[1];
    if (eventId && data) {
      const payload = JSON.parse(data);
      if (payload.issue?.title === reportBody.title) replayedEvent = { id: eventId, payload };
    }
  }
}
await reader.cancel();
assert.ok(BigInt(replayedEvent.id) > 0n);
assert.equal(replayedEvent.payload.issueId, issueId);
assert.equal(replayedEvent.payload.issue.id, issueId);

const replay = await request(`/api/v1/events/${eventId}/issues`, { method: 'POST', body: reportBody, idempotencyKey: reportKey });
assert.equal(replay.status, 201);
assert.equal(replay.data.issue.id, issueId);
assert.equal(replay.data.replayed, true);

const keyReuse = await request(`/api/v1/events/${eventId}/issues`, { method: 'POST', body: { ...reportBody, title: 'Different content' }, idempotencyKey: reportKey });
assert.equal(keyReuse.status, 409);

for (const [action, body] of [
  ['triage', { reason: 'Confirmed venue equipment issue.' }],
  ['assign', { ownerId: 'eli', reason: 'Facilities lead for this area.' }],
  ['escalate', { reason: 'Service begins in under 30 minutes.' }],
  ['resolve', { reason: 'Cooling unit reset; temperature is returning to range.' }],
  ['verify', { reason: 'Follow-up reading is within service range.' }],
  ['close', { reason: 'Issue verified and no further action is required.' }],
]) {
  const result = await request(`/api/v1/events/${eventId}/issues/${issueId}/${action}`, { method: 'POST', body, idempotencyKey: key() });
  assert.equal(result.status, 201, `${action} should succeed: ${JSON.stringify(result.data)}`);
}

const listed = await request(`/api/v1/events/${eventId}/issues`);
const finalIssue = listed.data.find((issue) => issue.id === issueId);
assert.equal(finalIssue.state, 'CLOSED');
assert.equal(finalIssue.auditEvents.length, 7);

process.stdout.write('Issue lifecycle, durable SSE replay, idempotency, key reuse conflict, and audit history passed.\n');
