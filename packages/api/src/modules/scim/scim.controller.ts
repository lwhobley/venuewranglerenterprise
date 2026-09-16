import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Role } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../auth/public.decorator';
import { ROLE_RANK } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';

interface ScimName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
}

interface ScimEmail {
  value: string;
  primary?: boolean;
}

interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails: ScimEmail[];
  active: boolean;
  roles?: Array<{ value: string; primary?: boolean }>;
  meta: {
    resourceType: string;
    created?: string;
    lastModified?: string;
  };
}

/** The organization and facility a SCIM token is bound to. */
interface ScimTenant {
  organizationId: string;
  facilityId: string;
}

/**
 * Roles an identity provider may assign. Owner and administrator tiers
 * (ROLE_RANK 3) are granted inside Venue Wrangler only, so a compromised or
 * misconfigured IdP cannot mint administrators.
 */
export const SCIM_PROVISIONABLE_ROLES: readonly string[] = Object.keys(ROLE_RANK).filter((role) => ROLE_RANK[role] < 3);

export const SCIM_MIN_TOKEN_LENGTH = 32;

// The global AuthGuard expects a user session JWT in the Authorization
// header, which an identity provider never has. SCIM authenticates with its
// own bearer token instead, so the guard is skipped and every handler must
// call authenticate() before touching data.
@Public()
@Controller('v1/scim/v2')
@UseInterceptors(TenantRequestTransactionInterceptor)
export class ScimController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fails closed: there is no built-in token, and provisioning is refused until
   * the token is bound to one organization and facility.
   */
  private authenticate(authHeader?: string): ScimTenant {
    const configuredToken = this.config.get<string>('SCIM_BEARER_TOKEN');
    const organizationId = this.config.get<string>('SCIM_ORGANIZATION_ID');
    const facilityId = this.config.get<string>('SCIM_FACILITY_ID');
    if (!configuredToken || configuredToken.length < SCIM_MIN_TOKEN_LENGTH || !organizationId || !facilityId) {
      throw new ServiceUnavailableException('SCIM provisioning is not configured.');
    }
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid SCIM Bearer token.');
    }
    const provided = createHash('sha256').update(authHeader.slice(7).trim()).digest();
    const expected = createHash('sha256').update(configuredToken).digest();
    if (!timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Unauthorized SCIM token.');
    }
    return { organizationId, facilityId };
  }

  /** Profiles at any venue of the token's organization, and nowhere else. */
  private inTenant(tenant: ScimTenant) {
    return { venue: { organizationId: tenant.organizationId } };
  }

  private assertManageable(profile: { role: string }) {
    if ((ROLE_RANK[profile.role] ?? 3) >= 3) {
      throw new ConflictException('Owner and administrator accounts are managed in Venue Wrangler, not through SCIM.');
    }
  }

  private provisionableRole(value: unknown): Role {
    if (value == null || value === '') return 'staff';
    if (typeof value !== 'string' || !SCIM_PROVISIONABLE_ROLES.includes(value)) {
      throw new BadRequestException(`Role "${String(value)}" cannot be assigned through SCIM.`);
    }
    return value as Role;
  }

  private toScimUser(profile: any): ScimUserResource {
    const givenName = profile.fullName ? profile.fullName.split(' ')[0] : '';
    const familyName = profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : '';
    const isActive = profile.membershipStatus !== 'revoked' && profile.membershipStatus !== 'rejected';

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: profile.id,
      userName: profile.email,
      name: {
        formatted: profile.fullName ?? profile.email,
        givenName,
        familyName,
      },
      displayName: profile.fullName ?? profile.email,
      emails: [{ value: profile.email, primary: true }],
      active: isActive,
      roles: profile.role ? [{ value: profile.role, primary: true }] : [],
      meta: {
        resourceType: 'User',
        created: profile.createdAt ? new Date(profile.createdAt).toISOString() : new Date().toISOString(),
        lastModified: profile.updatedAt ? new Date(profile.updatedAt).toISOString() : new Date().toISOString(),
      },
    };
  }

  @Get('ServiceProviderConfig')
  getServiceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://venuewrangler.com/docs/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          name: 'OAuth Bearer Token',
          description: 'Authentication scheme using OAuth Bearer Token',
          specUri: 'http://www.rfc-editor.org/info/rfc6750',
          type: 'oauthbearertoken',
          primary: true,
        },
      ],
    };
  }

  @Get('Users')
  async listUsers(
    @Headers('authorization') authHeader: string | undefined,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndexRaw?: string,
    @Query('count') countRaw?: string,
  ) {
    const tenant = this.authenticate(authHeader);

    const startIndex = Math.max(1, parseInt(startIndexRaw || '1', 10) || 1);
    const count = Math.min(100, Math.max(1, parseInt(countRaw || '50', 10) || 50));

    let emailFilter: string | undefined;
    if (filter) {
      const match = filter.match(/userName\s+eq\s+["']?([^"']+)["']?/i);
      if (match) emailFilter = match[1];
    }

    const where = {
      ...this.inTenant(tenant),
      ...(emailFilter ? { email: { equals: emailFilter, mode: 'insensitive' as const } } : {}),
    };

    const [profiles, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.profile.count({ where }),
    ]);

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: profiles.length,
      Resources: profiles.map((p) => this.toScimUser(p)),
    };
  }

  @Get('Users/:id')
  async getUser(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const tenant = this.authenticate(authHeader);
    const profile = await this.prisma.profile.findFirst({ where: { id, ...this.inTenant(tenant) } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);
    return this.toScimUser(profile);
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any,
  ) {
    const tenant = this.authenticate(authHeader);

    const rawEmail = body?.userName || body?.emails?.[0]?.value;
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      throw new BadRequestException('SCIM User must include userName or email.');
    }
    const email = rawEmail.trim().toLowerCase();
    const fullName = body.name?.formatted || `${body.name?.givenName ?? ''} ${body.name?.familyName ?? ''}`.trim() || email;
    const role = this.provisionableRole(body.roles?.[0]?.value);
    const isActive = body.active !== false;

    // The configured facility must belong to the token's organization.
    const venue = await this.prisma.venue.findFirst({
      where: { id: tenant.facilityId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!venue) throw new ServiceUnavailableException('The SCIM facility is not part of the configured organization.');

    const existing = await this.prisma.profile.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, ...this.inTenant(tenant) },
    });
    if (existing) {
      this.assertManageable(existing);
      const updated = await this.prisma.profile.update({
        where: { id: existing.id },
        data: {
          fullName,
          role,
          membershipStatus: isActive ? 'active' : 'revoked',
        },
      });
      return this.toScimUser(updated);
    }

    const created = await this.prisma.profile.create({
      data: {
        venueId: venue.id,
        email,
        fullName,
        jobTitle: body.title || 'Staff Member',
        role,
        membershipStatus: isActive ? 'active' : 'revoked',
      },
    });

    return this.toScimUser(created);
  }

  @Patch('Users/:id')
  async patchUser(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const tenant = this.authenticate(authHeader);
    const profile = await this.prisma.profile.findFirst({ where: { id, ...this.inTenant(tenant) } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);
    this.assertManageable(profile);

    let nextActive = profile.membershipStatus !== 'revoked';
    let nextName = profile.fullName;

    const operations = Array.isArray(body?.Operations) ? body.Operations : [];
    for (const op of operations) {
      if (op.path === 'active' || op.value?.active !== undefined) {
        const val = op.path === 'active' ? op.value : op.value.active;
        nextActive = val === true || val === 'true' || val === 'True';
      }
      if (op.path === 'name.formatted' || op.value?.name?.formatted) {
        const name = op.path === 'name.formatted' ? op.value : op.value.name.formatted;
        if (typeof name === 'string' && name.trim()) nextName = name.trim();
      }
    }

    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        fullName: nextName,
        membershipStatus: nextActive ? 'active' : 'revoked',
      },
    });

    return this.toScimUser(updated);
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const tenant = this.authenticate(authHeader);
    const profile = await this.prisma.profile.findFirst({ where: { id, ...this.inTenant(tenant) } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);
    this.assertManageable(profile);

    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { membershipStatus: 'revoked' },
    });
  }
}
