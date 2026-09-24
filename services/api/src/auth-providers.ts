import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SsoProviderKind = 'okta' | 'entra';

export interface SsoProviderConfig {
  id: SsoProviderKind;
  organizationSlug: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  audience: string;
  scopes: string[];
}

@Injectable()
export class AuthProvidersService {
  private readonly providers: SsoProviderConfig[];

  constructor(config: ConfigService) {
    const raw = config.get<string>('SSO_PROVIDERS_JSON') ?? '[]';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('SSO_PROVIDERS_JSON must be valid JSON.');
    }
    if (!Array.isArray(parsed)) throw new Error('SSO_PROVIDERS_JSON must be an array.');

    const seen = new Set<string>();
    const seenIssuers = new Set<string>();
    this.providers = parsed.map((value, index) => {
      if (!value || typeof value !== 'object') throw new Error(`SSO provider ${index} must be an object.`);
      const item = value as Record<string, unknown>;
      const id = item.id;
      const organizationSlug = item.organizationSlug;
      const tenantId = item.tenantId;
      const issuer = item.issuer;
      const clientId = item.clientId;
      const audience = item.audience;
      const scopes = item.scopes;
      if ((id !== 'okta' && id !== 'entra') || typeof organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(organizationSlug) || typeof tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) || typeof issuer !== 'string' || typeof clientId !== 'string' || !clientId || typeof audience !== 'string' || !audience || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
        throw new Error(`SSO provider ${index} has invalid required fields.`);
      }
      if (!scopes.includes('openid')) throw new Error(`SSO provider ${index} must request the openid scope.`);
      const issuerUrl = new URL(issuer);
      if (issuerUrl.protocol !== 'https:' || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
        throw new Error(`SSO provider ${index} issuer must be an HTTPS issuer URL.`);
      }
      if (seenIssuers.has(issuerUrl.href)) throw new Error(`OIDC issuer ${issuerUrl.href} must map to only one organization.`);
      seenIssuers.add(issuerUrl.href);
      const key = `${organizationSlug}:${id}`;
      if (seen.has(key)) throw new Error(`Duplicate SSO provider ${key}.`);
      seen.add(key);
      return { id, organizationSlug, tenantId, issuer: issuerUrl.href, clientId, audience, scopes: scopes as string[] };
    });
    if (config.get<string>('NODE_ENV') === 'production' && this.providers.length === 0) {
      throw new Error('At least one enterprise SSO provider must be configured in production.');
    }
  }

  forOrganization(slug: string) {
    const providers = this.providers.filter((provider) => provider.organizationSlug === slug);
    if (!providers.length) return null;
    return {
      organizationSlug: slug,
      providers: providers.map(({ id, issuer, clientId, scopes }) => ({
        id,
        name: id === 'entra' ? 'Microsoft Entra ID' : 'Okta',
        issuer,
        clientId,
        scopes,
      })),
    };
  }

  forIssuer(issuer: string) {
    return this.providers.find((provider) => provider.issuer === issuer);
  }

  get hasProviders() {
    return this.providers.length > 0;
  }
}
