import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Identity } from './auth';
import { AuthProvidersService } from './auth-providers';
import { PrismaService } from './prisma.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionMinutes = 15;

const venueCapabilities: Identity['capabilities'] = [
  'issue:report', 'issue:read', 'issue:evidence', 'issue:triage', 'issue:escalate',
  'issue:resolve', 'issue:verify', 'issue:close', 'operations:read',
  'operations:write', 'event:closeout', 'vendor:staffing', 'hospitality:order',
  'hospitality:fulfill', 'notification:read', 'venue:admin',
];

@Injectable()
export class SupportAccessService {
  private readonly operators: Set<string>;

  constructor(config: ConfigService, private readonly providers: AuthProvidersService, private readonly prisma: PrismaService) {
    let values: unknown;
    try {
      values = JSON.parse(config.get<string>('SUPPORT_OPERATORS_JSON') ?? '[]');
    } catch {
      throw new Error('SUPPORT_OPERATORS_JSON must be valid JSON.');
    }
    if (!Array.isArray(values)) throw new Error('SUPPORT_OPERATORS_JSON must be an array.');
    this.operators = new Set(values.map((value, index) => {
      if (!value || typeof value !== 'object') throw new Error(`Support operator ${index} must be an object.`);
      const { issuer, subject } = value as Record<string, unknown>;
      if (typeof issuer !== 'string' || !this.providers.forIssuer(issuer) || typeof subject !== 'string' || subject.length < 1 || subject.length > 512) {
        throw new Error(`Support operator ${index} must match a configured SSO issuer and subject.`);
      }
      return `${issuer}|${subject}`;
    }));
  }

  private assertOperator(identity: Identity) {
    if (identity.supportAccessSessionId || !identity.capabilities.includes('support:access') || !this.operators.has(identity.subject)) {
      throw new ForbiddenException('Technical support access is not enabled for this account.');
    }
  }

  async venues(identity: Identity) {
    this.assertOperator(identity);
    const tenants = this.providers.tenantConfigs();
    const results = await Promise.all(tenants.map(async (tenant) => this.prisma.withTenant({ ...identity, tenantId: tenant.tenantId }, async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: tenant.tenantId }, select: { id: true, name: true } });
      if (!organization) return [];
      const venues = await tx.venue.findMany({ where: { organizationId: tenant.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, lifecycleState: true, timeZone: true } });
      return venues.map((venue) => ({ ...venue, organizationId: organization.id, organizationName: organization.name }));
    })));
    return results.flat().sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name));
  }

  async enter(identity: Identity, venueId: string, reason: string) {
    this.assertOperator(identity);
    if (!uuid.test(venueId)) throw new BadRequestException('Choose a valid venue.');
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10 || normalizedReason.length > 500) throw new BadRequestException('Give a support reason of 10 to 500 characters.');
    const selected = (await this.venues(identity)).find((venue) => venue.id === venueId);
    if (!selected) throw new NotFoundException('Venue is not available for support access.');
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const accessToken = `${selected.organizationId}.${sessionId}.${secret}`;
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const expiresAt = new Date(Date.now() + sessionMinutes * 60_000);
    await this.prisma.withTenant({ ...identity, tenantId: selected.organizationId }, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, organizationId: selected.organizationId }, select: { id: true } });
      if (!venue) throw new NotFoundException('Venue is no longer available for support access.');
      await tx.supportAccessSession.create({ data: {
        id: sessionId, organizationId: selected.organizationId, venueId,
        operatorSubject: identity.subject, operatorTenantId: identity.tenantId,
        reason: normalizedReason, tokenHash, expiresAt,
      } });
      await tx.supportAccessActivity.create({ data: { organizationId: selected.organizationId, sessionId, method: 'POST', path: '/api/v1/support/access' } });
    });
    return { accessToken, expiresAt, venueId, venueName: selected.name, organizationName: selected.organizationName };
  }

  async resolve(identity: Identity, accessToken: string, method: string, path: string): Promise<Identity> {
    this.assertOperator(identity);
    const parts = accessToken.split('.');
    if (parts.length !== 3 || !uuid.test(parts[0]) || !uuid.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) throw new UnauthorizedException('Support access has expired or is invalid.');
    const [tenantId, sessionId] = parts;
    const expectedHash = createHash('sha256').update(accessToken).digest();
    return this.prisma.withTenant({ ...identity, tenantId }, async (tx) => {
      const session = await tx.supportAccessSession.findFirst({ where: { id: sessionId, organizationId: tenantId } });
      if (!session || session.operatorSubject !== identity.subject || session.operatorTenantId !== identity.tenantId || session.revokedAt || session.expiresAt <= new Date() || !timingSafeEqual(expectedHash, Buffer.from(session.tokenHash, 'hex'))) {
        throw new UnauthorizedException('Support access has expired or is invalid.');
      }
      const [venue, events, locations, people] = await Promise.all([
        tx.venue.findFirst({ where: { id: session.venueId, organizationId: tenantId }, select: { id: true } }),
        tx.event.findMany({ where: { organizationId: tenantId, venueId: session.venueId }, select: { id: true } }),
        tx.location.findMany({ where: { organizationId: tenantId, venueId: session.venueId }, select: { id: true } }),
        tx.person.findMany({ where: { organizationId: tenantId, active: true }, select: { externalSubject: true } }),
      ]);
      if (!venue) throw new UnauthorizedException('The support venue is unavailable.');
      await tx.supportAccessActivity.create({ data: {
        organizationId: tenantId, sessionId,
        method: method.toUpperCase().slice(0, 10), path: path.slice(0, 500),
      } });
      return {
        ...identity, tenantId, organizationSlug: this.providers.tenantConfigs().find((tenant) => tenant.tenantId === tenantId)?.organizationSlug,
        supportAccessSessionId: sessionId,
        capabilities: venueCapabilities, venueIds: [session.venueId],
        eventIds: events.map((event) => event.id),
        locationIds: locations.map((location) => location.id),
        assignableUserIds: people.map((person) => person.externalSubject),
      };
    });
  }

  async exit(identity: Identity) {
    if (!identity.supportAccessSessionId) throw new ForbiddenException('There is no active support venue session.');
    await this.prisma.withTenant(identity, async (tx) => {
      await tx.supportAccessSession.updateMany({
        where: { id: identity.supportAccessSessionId, organizationId: identity.tenantId, operatorSubject: identity.subject, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { exited: true };
  }
}
