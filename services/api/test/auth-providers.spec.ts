import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AuthProvidersService } from '../src/auth-providers';

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';

function provider(id: 'okta' | 'entra', tenantId: string, issuer: string, organizationSlug = 'harbor-city') {
  return { id, tenantId, organizationSlug, issuer, clientId: `${id}-client`, audience: `${id}-audience`, scopes: ['openid', 'email', 'profile'] };
}

function service(providers: unknown[], nodeEnv = 'test') {
  const config = {
    get: (key: string) => key === 'SSO_PROVIDERS_JSON' ? JSON.stringify(providers) : nodeEnv,
  } as unknown as ConfigService;
  return new AuthProvidersService(config);
}

describe('SSO provider tenant mapping', () => {
  it('allows Okta and Entra to authenticate the same organization tenant', () => {
    const result = service([
      provider('okta', tenantA, 'https://acme.okta.com/oauth2/default'),
      provider('entra', tenantA, 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0'),
    ]).forOrganization('harbor-city');

    expect(result?.providers.map((item) => item.id)).toEqual(['okta', 'entra']);
  });

  it('rejects provider choices that map one organization to different data tenants', () => {
    expect(() => service([
      provider('okta', tenantA, 'https://acme.okta.com/oauth2/default'),
      provider('entra', tenantB, 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0'),
    ])).toThrow('All SSO providers for organization harbor-city must use the same tenantId.');
  });

  it('rejects mapping one tenant to multiple organization slugs', () => {
    expect(() => service([
      provider('okta', tenantA, 'https://acme.okta.com/oauth2/default', 'harbor-city'),
      provider('entra', tenantA, 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0', 'other-city'),
    ])).toThrow(`Tenant ${tenantA} cannot be mapped to multiple organization slugs.`);
  });

  it('fails closed when production has no enterprise SSO provider configured', () => {
    expect(() => service([], 'production')).toThrow('At least one enterprise SSO provider must be configured in production.');
  });
});
