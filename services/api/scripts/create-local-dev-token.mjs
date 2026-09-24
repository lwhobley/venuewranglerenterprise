import { SignJWT } from 'jose';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The local development token helper cannot run in production.');
}

const secret = process.env.JWT_HS256_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('Set the local JWT_HS256_SECRET before creating a development token.');
}

const token = await new SignJWT({
  tenant_id: '00000000-0000-4000-8000-000000000001',
  capabilities: ['issue:report', 'issue:read', 'issue:triage', 'issue:escalate', 'issue:resolve', 'issue:verify', 'issue:close'],
  venue_ids: ['10000000-0000-4000-8000-000000000001'],
  event_ids: ['20000000-0000-4000-8000-000000000001'],
  location_ids: [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ],
  assignable_user_ids: ['eli', 'maya'],
})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('local-event-manager')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(secret));

process.stdout.write(`${token}\n`);
