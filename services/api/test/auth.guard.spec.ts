import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { JwtIdentityGuard } from '../src/auth';
import { AuthProvidersService } from '../src/auth-providers';
import type { PrismaService } from '../src/prisma.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const venueId = '10000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const locationId = '30000000-0000-4000-8000-000000000001';
const providers = [
  { id: 'okta', organizationSlug: 'harbor-city', tenantId, issuer: 'https://acme.okta.test/oauth2/default', clientId: 'okta-native-client', audience: 'venue-api', scopes: ['openid', 'email'] },
  { id: 'entra', organizationSlug: 'harbor-city', tenantId, issuer: 'https://login.microsoftonline.test/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0', clientId: 'entra-native-client', audience: 'venue-api', scopes: ['openid', 'email'] },
];

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  const signingKey = { ...publicJwk, kid: 'integration-test-key', alg: 'RS256', use: 'sig' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${providers[0].issuer}/.well-known/openid-configuration` || url === `${providers[1].issuer}/.well-known/openid-configuration`) {
      const issuer = url.startsWith(providers[0].issuer) ? providers[0].issuer : providers[1].issuer;
      return new Response(JSON.stringify({ issuer, jwks_uri: `${new URL(issuer).origin}/keys` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/keys')) return new Response(JSON.stringify({ keys: [signingKey] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  const values: Record<string, string> = { SSO_PROVIDERS_JSON: JSON.stringify(providers), NODE_ENV: 'production' };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  const providerService = new AuthProvidersService(config);
  const findPerson = vi.fn().mockResolvedValue({ active: true });
  const tx = { person: { findFirst: findPerson } };
  const prisma = {
    withTenant: vi.fn((_identity: Identity, action: (transaction: typeof tx) => unknown) => Promise.resolve(action(tx))),
  } as unknown as PrismaService;
  const guard = new JwtIdentityGuard(config, providerService, prisma);

  async function token(
    providerId: 'okta' | 'entra',
    overrides: Record<string, unknown> = {},
    options: { audience?: string; issuedAt?: number; expiresAt?: number | string } = {},
  ) {
    const provider = providers.find((item) => item.id === providerId)!;
    return new SignJWT({
      ...(providerId === 'okta' ? { cid: provider.clientId } : { azp: provider.clientId }),
      capabilities: ['issue:read', 'operations:write', 'event:closeout'],
      event_ids: [eventId],
      venue_ids: [venueId],
      location_ids: [locationId],
      assignable_user_ids: ['https://idp.test|worker-2'],
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'integration-test-key' })
      .setIssuer(provider.issuer)
      .setAudience(options.audience ?? provider.audience)
      .setSubject('worker-1')
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expiresAt ?? '5m')
      .sign(privateKey);
  }

  return { guard, token, findPerson, fetchMock };
}

function contextFor(token: string) {
  const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
  return {
    request,
    context: { switchToHttp: () => ({ getRequest: () => request }) },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('enterprise JWT identity guard', () => {
  it.each(['okta', 'entra'] as const)('accepts a correctly signed %s token and derives the tenant from provider configuration', async (providerId) => {
    const { guard, token, findPerson } = await setup();
    const signed = await token(providerId);
    const { context, request } = contextFor(signed);

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.identity).toMatchObject({
      tenantId,
      organizationSlug: 'harbor-city',
      subject: `${providers.find((item) => item.id === providerId)!.issuer}|worker-1`,
      capabilities: ['issue:read', 'operations:write', 'event:closeout'],
      venueIds: [venueId],
      eventIds: [eventId],
      locationIds: [locationId],
    });
    expect(findPerson).toHaveBeenCalledWith({
      where: { organizationId: tenantId, externalSubject: `${providers.find((item) => item.id === providerId)!.issuer}|worker-1` },
      select: { active: true },
    });
  });

  it('rejects a validly signed token issued to a different native client', async () => {
    const { guard, token } = await setup();
    const signed = await token('okta', { cid: 'other-client' });
    await expect(guard.canActivate(contextFor(signed).context as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a correctly signed token with the wrong API audience', async () => {
    const { guard, token, findPerson } = await setup();
    const signed = await token('entra', {}, { audience: 'another-api' });
    await expect(guard.canActivate(contextFor(signed).context as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findPerson).not.toHaveBeenCalled();
  });

  it('rejects expired signed tokens', async () => {
    const { guard, token, findPerson } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const signed = await token('okta', {}, { issuedAt: now - 600, expiresAt: now - 300 });
    await expect(guard.canActivate(contextFor(signed).context as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findPerson).not.toHaveBeenCalled();
  });

  it('rejects malformed venue/event/location UUID claims before tenant data access', async () => {
    const { guard, token, findPerson } = await setup();
    const signed = await token('entra', { event_ids: ['not-a-uuid'] });
    await expect(guard.canActivate(contextFor(signed).context as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findPerson).not.toHaveBeenCalled();
  });

  it('rejects deactivated roster identities after cryptographic verification', async () => {
    const { guard, token, findPerson } = await setup();
    findPerson.mockResolvedValue({ active: false });
    const signed = await token('okta');
    await expect(guard.canActivate(contextFor(signed).context as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
