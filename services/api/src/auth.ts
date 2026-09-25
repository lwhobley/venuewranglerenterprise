import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuthProvidersService, type SsoProviderConfig } from './auth-providers';
import { PrismaService } from './prisma.service';

export type Capability = 'issue:report' | 'issue:read' | 'issue:evidence' | 'issue:triage' | 'issue:escalate' | 'issue:resolve' | 'issue:verify' | 'issue:close' | 'operations:read' | 'operations:write' | 'hospitality:order' | 'hospitality:fulfill' | 'notification:read' | 'tenant:admin';
const capabilities = new Set<Capability>(['issue:report', 'issue:read', 'issue:evidence', 'issue:triage', 'issue:escalate', 'issue:resolve', 'issue:verify', 'issue:close', 'operations:read', 'operations:write', 'hospitality:order', 'hospitality:fulfill', 'notification:read', 'tenant:admin']);
const uuidClaimPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Identity {
  subject: string;
  tenantId: string;
  organizationSlug?: string;
  email?: string;
  displayName?: string;
  capabilities: Capability[];
  venueIds: string[];
  eventIds: string[];
  locationIds: string[];
  assignableUserIds: string[];
}

declare module 'express-serve-static-core' {
  interface Request { identity: Identity; }
}

@Injectable()
export class JwtIdentityGuard implements CanActivate {
  private readonly jwks = new Map<string, Promise<JWTVerifyGetKey>>();

  constructor(private readonly config: ConfigService, private readonly providers: AuthProvidersService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization;
    if (typeof token !== 'string' || !token.startsWith('Bearer ')) throw new UnauthorizedException('A bearer token is required.');
    try {
      const compactToken = token.slice(7);
      const unverified = decodeJwt(compactToken);
      const issuer = typeof unverified.iss === 'string' ? unverified.iss : '';
      const provider = this.providers.forIssuer(issuer);
      let payload;
      let subjectPrefix = '';
      if (provider) {
        const { payload: verified } = await jwtVerify(compactToken, await this.keysFor(provider), {
          issuer: provider.issuer,
          audience: provider.audience,
          algorithms: ['RS256'],
          maxTokenAge: '1h',
        });
        payload = verified;
        subjectPrefix = `${provider.issuer}|`;
        const authorizedClient = provider.id === 'entra' ? payload.azp : payload.cid;
        if (authorizedClient !== provider.clientId || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') throw new UnauthorizedException('The token client or lifetime is invalid.');
      } else {
        if (this.config.get<string>('NODE_ENV') === 'production') throw new UnauthorizedException('The access token issuer is not configured.');
        const secret = this.config.get<string>('JWT_HS256_SECRET');
        if (!secret || secret.length < 32) throw new UnauthorizedException('Token verification is unavailable.');
        const { payload: verified } = await jwtVerify(compactToken, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
        payload = verified;
      }
      const tenantId = provider?.tenantId ?? (typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined);
      const hasValidUuidScope = (claim: unknown): claim is string[] => Array.isArray(claim) && claim.every((value) => typeof value === 'string' && uuidClaimPattern.test(value));
      const hasValidAssignmentScope = Array.isArray(payload.assignable_user_ids) && payload.assignable_user_ids.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 512);
      if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 512 || !tenantId || !Array.isArray(payload.capabilities) || payload.capabilities.some((capability) => typeof capability !== 'string' || !capabilities.has(capability as Capability)) || !hasValidUuidScope(payload.event_ids) || !hasValidUuidScope(payload.venue_ids) || !hasValidUuidScope(payload.location_ids) || !hasValidAssignmentScope) throw new UnauthorizedException('The access token is missing valid capability and UUID scope claims.');
      request.identity = { subject: `${subjectPrefix}${payload.sub}`, tenantId, organizationSlug: provider?.organizationSlug, email: typeof payload.email === 'string' ? payload.email : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined, displayName: typeof payload.name === 'string' ? payload.name : undefined, capabilities: payload.capabilities as Capability[], eventIds: payload.event_ids as string[], venueIds: payload.venue_ids as string[], locationIds: payload.location_ids as string[], assignableUserIds: payload.assignable_user_ids as string[] };
    } catch { throw new UnauthorizedException('The access token is invalid.'); }
    const provisionedUser = await this.prisma.withTenant(request.identity, (tx) => tx.person.findFirst({
      where: { organizationId: request.identity.tenantId, externalSubject: request.identity.subject },
      select: { active: true },
    }));
    if (provisionedUser?.active === false) throw new UnauthorizedException('This account is deactivated. Contact your identity administrator.');
    return true;
  }

  private async keysFor(provider: SsoProviderConfig): Promise<JWTVerifyGetKey> {
    let keySet = this.jwks.get(provider.issuer);
    if (!keySet) {
      keySet = this.loadKeys(provider);
      this.jwks.set(provider.issuer, keySet);
      keySet.catch(() => this.jwks.delete(provider.issuer));
    }
    return keySet;
  }

  private async loadKeys(provider: SsoProviderConfig): Promise<JWTVerifyGetKey> {
    const response = await fetch(`${provider.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('OIDC discovery failed.');
    const metadata = await response.json() as { issuer?: unknown; jwks_uri?: unknown };
    if (metadata.issuer !== provider.issuer || typeof metadata.jwks_uri !== 'string') throw new Error('OIDC discovery metadata does not match the configured issuer.');
    const jwksUrl = new URL(metadata.jwks_uri);
    if (jwksUrl.protocol !== 'https:' || jwksUrl.origin !== new URL(provider.issuer).origin) throw new Error('OIDC JWKS must use the configured issuer origin over HTTPS.');
    return createRemoteJWKSet(jwksUrl);
  }
}

export function assertScope(identity: Identity, capability: Capability, eventId: string, venueId?: string, locationId?: string) {
  if (!identity.capabilities.includes(capability)) throw new ForbiddenException('Your role cannot perform this action.');
  if (!identity.eventIds.includes(eventId) || (venueId && !identity.venueIds.includes(venueId))) throw new ForbiddenException('This event is outside your assigned scope.');
  if (locationId && !identity.locationIds.includes(locationId)) throw new ForbiddenException('This location is outside your assigned scope.');
}

export function assertAssignable(identity: Identity, userId: string) {
  if (!identity.assignableUserIds.includes(userId)) throw new ForbiddenException('This person is outside your assignment scope.');
}

export function assertTenantAdmin(identity: Identity) {
  if (!identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('Tenant administrator access is required.');
}

export function assertCapability(identity: Identity, capability: Capability) {
  if (!identity.capabilities.includes(capability)) throw new ForbiddenException('Your role cannot perform this action.');
}
