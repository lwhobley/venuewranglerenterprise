import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Identity } from './auth';
import { PrismaService } from './prisma.service';
import { AuthProvidersService } from './auth-providers';

interface ScimTenant {
  organizationSlug: string;
  tenantId: string;
  bearerToken: string;
  issuerPrefixes: string[];
}

interface ScimPerson {
  id: string;
  externalSubject: string;
  email: string;
  displayName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const coreUserSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
@Injectable()
export class ScimService {
  private readonly tenants: Array<ScimTenant & { tokenDigest: Buffer }>;

  constructor(config: ConfigService, private readonly prisma: PrismaService, authProviders: AuthProvidersService) {
    let values: unknown;
    try {
      values = JSON.parse(config.get<string>('SCIM_PROVIDERS_JSON') ?? '[]');
    } catch {
      throw new Error('SCIM_PROVIDERS_JSON must be valid JSON.');
    }
    if (!Array.isArray(values)) throw new Error('SCIM_PROVIDERS_JSON must be an array.');
    const slugs = new Set<string>();
    const tenantIds = new Set<string>();
    const digests = new Set<string>();
    this.tenants = values.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`SCIM tenant ${index} must be an object.`);
      const value = entry as Record<string, unknown>;
      const { organizationSlug, tenantId, bearerToken } = value;
      if (typeof organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(organizationSlug)
        || typeof tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
        || typeof bearerToken !== 'string' || bearerToken.length < 32) {
        throw new Error(`SCIM tenant ${index} has invalid fields; use a tenant UUID and a random bearer token of at least 32 characters.`);
      }
      const digest = createHash('sha256').update(bearerToken, 'utf8').digest();
      const digestText = digest.toString('hex');
      if (slugs.has(organizationSlug) || tenantIds.has(tenantId) || digests.has(digestText)) throw new Error(`SCIM tenant ${index} duplicates a slug, tenant, or bearer token.`);
      const sso = authProviders.forOrganization(organizationSlug);
      if (!sso?.providers.length || sso.providers.some((provider) => authProviders.forIssuer(provider.issuer)?.tenantId !== tenantId)) throw new Error(`SCIM tenant ${index} must match the configured Okta or Entra issuer-to-tenant mapping.`);
      slugs.add(organizationSlug);
      tenantIds.add(tenantId);
      digests.add(digestText);
      return { organizationSlug, tenantId, bearerToken, tokenDigest: digest, issuerPrefixes: sso.providers.map((provider) => `${provider.issuer}|`) };
    });
  }

  identityFor(authorization: string | undefined): Identity {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new UnauthorizedException('A SCIM bearer token is required.');
    const supplied = createHash('sha256').update(authorization.slice(7), 'utf8').digest();
    const tenant = this.tenants.find((candidate) => timingSafeEqual(candidate.tokenDigest, supplied));
    if (!tenant) throw new UnauthorizedException('The SCIM bearer token is invalid.');
    return {
      subject: `scim:${tenant.organizationSlug}`,
      tenantId: tenant.tenantId,
      organizationSlug: tenant.organizationSlug,
      capabilities: [],
      venueIds: [],
      eventIds: [],
      locationIds: [],
      assignableUserIds: [],
    };
  }

  async listUsers(identity: Identity, filter: string | undefined, startIndex = 1, count = 100) {
    const where = this.filter(filter);
    return this.prisma.withTenant(identity, async (tx) => {
      const totalResults = await tx.person.count({ where });
      const resources = await tx.person.findMany({
        where,
        orderBy: { email: 'asc' },
        skip: startIndex - 1,
        take: count,
      });
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults,
        startIndex,
        itemsPerPage: resources.length,
        Resources: resources.map((person) => this.resource(person)),
      };
    });
  }

  async getUser(identity: Identity, id: string) {
    return this.prisma.withTenant(identity, async (tx) => {
      const person = await tx.person.findFirst({ where: { id, organizationId: identity.tenantId } });
      if (!person) throw new NotFoundException(this.scimError(404, 'User not found.'));
      return this.resource(person);
    });
  }

  async createUser(identity: Identity, input: unknown) {
    const data = this.userInput(identity, input);
    try {
      return await this.prisma.withTenant(identity, async (tx) => {
        const person = await tx.person.create({ data: { organizationId: identity.tenantId, ...data } });
        await this.auditPersonMutation(tx, identity, person.id, 'created', ['external_subject', 'email', 'display_name', 'active']);
        return this.resource(person);
      });
    } catch (error) {
      if (this.isDuplicate(error)) throw new ConflictException(this.scimError(409, 'A user with this externalId or userName already exists.'));
      throw error;
    }
  }

  async replaceUser(identity: Identity, id: string, input: unknown) {
    const data = this.userInput(identity, input);
    try {
      return await this.prisma.withTenant(identity, async (tx) => {
        const current = await tx.person.findFirst({ where: { id, organizationId: identity.tenantId } });
        if (!current) throw new NotFoundException(this.scimError(404, 'User not found.'));
        const person = await tx.person.update({ where: { id }, data });
        const changedFields = [
          ...(current.externalSubject !== person.externalSubject ? ['external_subject'] : []),
          ...(current.email !== person.email ? ['email'] : []),
          ...(current.displayName !== person.displayName ? ['display_name'] : []),
          ...(current.active !== person.active ? ['active'] : []),
        ];
        await this.auditPersonMutation(tx, identity, person.id, this.personAction(current.active, person.active), changedFields);
        return this.resource(person);
      });
    } catch (error) {
      if (this.isDuplicate(error)) throw new ConflictException(this.scimError(409, 'A user with this externalId or userName already exists.'));
      throw error;
    }
  }

  async patchUser(identity: Identity, id: string, body: unknown) {
    if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).Operations)) {
      throw new BadRequestException(this.scimError(400, 'SCIM PATCH requires an Operations array.'));
    }
    const current = await this.prisma.withTenant(identity, (tx) => tx.person.findFirst({ where: { id, organizationId: identity.tenantId } }));
    if (!current) throw new NotFoundException(this.scimError(404, 'User not found.'));
    const patch: { email?: string; displayName?: string; active?: boolean; externalSubject?: string } = {};
    for (const operation of (body as { Operations: unknown[] }).Operations) {
      if (!operation || typeof operation !== 'object') throw new BadRequestException(this.scimError(400, 'Invalid SCIM PATCH operation.'));
      const value = operation as Record<string, unknown>;
      const op = typeof value.op === 'string' ? value.op.toLowerCase() : '';
      const path = typeof value.path === 'string' ? value.path.toLowerCase() : '';
      if (op !== 'replace' && op !== 'add') throw new BadRequestException(this.scimError(400, 'Only add and replace SCIM PATCH operations are supported.'));
      if (!path && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) {
        const attributes = value.value as Record<string, unknown>;
        if (attributes.active !== undefined) patch.active = this.booleanValue(attributes.active, 'active');
        if (attributes.displayname !== undefined) patch.displayName = this.stringValue(attributes.displayname, 'displayName', 160);
        if (attributes.username !== undefined) patch.email = this.emailValue(attributes.username);
        if (attributes.externalid !== undefined) patch.externalSubject = this.externalIdValue(attributes.externalid, identity);
      } else if (path === 'active') patch.active = this.booleanValue(value.value, 'active');
      else if (path === 'displayname') patch.displayName = this.stringValue(value.value, 'displayName', 160);
      else if (path === 'username' || path === 'emails[type eq "work"].value') patch.email = this.emailValue(value.value);
      else if (path === 'externalid') patch.externalSubject = this.externalIdValue(value.value, identity);
      else throw new BadRequestException(this.scimError(400, `Unsupported SCIM PATCH path: ${path || '(root)'}.`));
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException(this.scimError(400, 'The SCIM PATCH contains no supported changes.'));
    try {
      return await this.prisma.withTenant(identity, async (tx) => {
        const person = await tx.person.update({ where: { id }, data: patch });
        const changedFields = [
          ...(current.externalSubject !== person.externalSubject ? ['external_subject'] : []),
          ...(current.email !== person.email ? ['email'] : []),
          ...(current.displayName !== person.displayName ? ['display_name'] : []),
          ...(current.active !== person.active ? ['active'] : []),
        ];
        await this.auditPersonMutation(tx, identity, person.id, this.personAction(current.active, person.active), changedFields);
        return this.resource(person);
      });
    } catch (error) {
      if (this.isDuplicate(error)) throw new ConflictException(this.scimError(409, 'A user with this externalId or userName already exists.'));
      throw error;
    }
  }

  async deactivateUser(identity: Identity, id: string) {
    return this.prisma.withTenant(identity, async (tx) => {
      const current = await tx.person.findFirst({ where: { id, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException(this.scimError(404, 'User not found.'));
      const person = await tx.person.update({ where: { id }, data: { active: false } });
      await this.auditPersonMutation(tx, identity, person.id, 'deactivated', current.active ? ['active'] : []);
    });
  }

  private personAction(wasActive: boolean, isActive: boolean) {
    if (wasActive !== isActive) return isActive ? 'reactivated' : 'deactivated';
    return 'updated';
  }

  private async auditPersonMutation(tx: Prisma.TransactionClient, identity: Identity, personId: string, action: string, changedFields: string[]) {
    if (changedFields.length === 0) return;
    await tx.personAuditEvent.create({
      data: {
        organizationId: identity.tenantId,
        personId,
        actorId: identity.subject,
        action,
        changedFields,
      },
    });
  }

  private filter(filter: string | undefined): Prisma.PersonWhereInput {
    if (!filter) return {};
    const match = /^\s*(externalId|userName)\s+eq\s+"([^"\\]{1,320})"\s*$/i.exec(filter);
    if (!match) throw new BadRequestException(this.scimError(400, 'Supported SCIM filters are externalId eq "value" and userName eq "value".'));
    return match[1].toLowerCase() === 'externalid'
      ? { externalSubject: match[2] }
      : { email: match[2].trim().toLowerCase() };
  }

  private userInput(identity: Identity, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(this.scimError(400, 'A SCIM User resource is required.'));
    const body = value as Record<string, unknown>;
    const emails = Array.isArray(body.emails) ? body.emails : [];
    const primaryEmail = emails.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).primary === true) as Record<string, unknown> | undefined;
    const firstEmail = emails.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined;
    const email = this.emailValue(body.userName ?? primaryEmail?.value ?? firstEmail?.value);
    const externalSubject = this.externalIdValue(body.externalId, identity);
    const displayName = body.displayName === undefined
      ? [this.stringOptional((body.name as Record<string, unknown> | undefined)?.givenName), this.stringOptional((body.name as Record<string, unknown> | undefined)?.familyName)].filter(Boolean).join(' ').trim() || email
      : this.stringValue(body.displayName, 'displayName', 160);
    const active = body.active === undefined ? true : this.booleanValue(body.active, 'active');
    return { externalSubject, email, displayName, active };
  }

  private resource(person: ScimPerson) {
    return {
      schemas: [coreUserSchema],
      id: person.id,
      externalId: person.externalSubject,
      userName: person.email,
      name: { formatted: person.displayName },
      displayName: person.displayName,
      active: person.active,
      emails: [{ value: person.email, type: 'work', primary: true }],
      meta: { resourceType: 'User', created: person.createdAt.toISOString(), lastModified: person.updatedAt.toISOString(), location: `/api/scim/v2/Users/${person.id}` },
    };
  }

  private emailValue(value: unknown) {
    const email = this.stringValue(value, 'userName', 320).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException(this.scimError(400, 'userName must be a valid email address.'));
    return email;
  }

  private externalIdValue(value: unknown, identity: Identity) {
    const externalId = this.stringValue(value, 'externalId', 320);
    const tenant = this.tenants.find((candidate) => candidate.tenantId === identity.tenantId);
    if (!tenant?.issuerPrefixes.some((prefix) => externalId.startsWith(prefix) && externalId.length > prefix.length)) {
      throw new BadRequestException(this.scimError(400, 'externalId must be the canonical issuer|subject value for this tenant.'));
    }
    return externalId;
  }

  private stringValue(value: unknown, field: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(this.scimError(400, `${field} must be a non-empty string of at most ${max} characters.`));
    return value.trim();
  }

  private stringOptional(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

  private booleanValue(value: unknown, field: string) {
    if (typeof value !== 'boolean') throw new BadRequestException(this.scimError(400, `${field} must be a boolean.`));
    return value;
  }

  private isDuplicate(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private scimError(status: number, detail: string) { return { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: String(status), detail }; }
}

export { coreUserSchema };
