import {
  BadRequestException,
  Body,
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
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Controller('v1/scim/v2')
@UseInterceptors(TenantRequestTransactionInterceptor)
export class ScimController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private authenticate(authHeader?: string) {
    const configuredToken = this.config.get<string>('SCIM_BEARER_TOKEN') || 'scim-enterprise-token';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid SCIM Bearer token.');
    }
    const token = authHeader.slice(7).trim();
    if (token !== configuredToken) {
      throw new UnauthorizedException('Unauthorized SCIM token.');
    }
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
    this.authenticate(authHeader);

    const startIndex = Math.max(1, parseInt(startIndexRaw || '1', 10));
    const count = Math.min(100, Math.max(1, parseInt(countRaw || '50', 10)));

    let emailFilter: string | undefined;
    if (filter) {
      const match = filter.match(/userName\s+eq\s+["']?([^"']+)["']?/i);
      if (match) emailFilter = match[1];
    }

    const where = emailFilter ? { email: emailFilter } : {};

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
    this.authenticate(authHeader);
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);
    return this.toScimUser(profile);
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any,
  ) {
    this.authenticate(authHeader);

    const email = body.userName || body.emails?.[0]?.value;
    if (!email) throw new BadRequestException('SCIM User must include userName or email.');

    const fullName = body.name?.formatted || `${body.name?.givenName ?? ''} ${body.name?.familyName ?? ''}`.trim() || email;
    const role = body.roles?.[0]?.value || 'staff';
    const isActive = body.active !== false;

    // Find default venue to anchor provisioned profile
    const defaultVenue = await this.prisma.venue.findFirst({ select: { id: true } });
    if (!defaultVenue) throw new BadRequestException('No venue exists to associate SCIM user.');

    // Look for existing user/profile
    const existing = await this.prisma.profile.findFirst({ where: { email } });
    if (existing) {
      const updated = await this.prisma.profile.update({
        where: { id: existing.id },
        data: {
          fullName,
          role: role as any,
          membershipStatus: isActive ? 'active' : 'revoked',
        },
      });
      return this.toScimUser(updated);
    }

    const created = await this.prisma.profile.create({
      data: {
        venueId: defaultVenue.id,
        email,
        fullName,
        jobTitle: body.title || 'Staff Member',
        role: role as any,
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
    this.authenticate(authHeader);
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);

    let nextActive = profile.membershipStatus !== 'revoked';
    let nextName = profile.fullName;

    const operations = body.Operations || [];
    for (const op of operations) {
      if (op.path === 'active' || op.value?.active !== undefined) {
        const val = op.path === 'active' ? op.value : op.value.active;
        nextActive = Boolean(val);
      }
      if (op.path === 'name.formatted' || op.value?.name?.formatted) {
        nextName = op.path === 'name.formatted' ? op.value : op.value.name.formatted;
      }
    }

    const updated = await this.prisma.profile.update({
      where: { id },
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
    this.authenticate(authHeader);
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`SCIM user with id ${id} not found.`);

    await this.prisma.profile.update({
      where: { id },
      data: { membershipStatus: 'revoked' },
    });
  }
}
