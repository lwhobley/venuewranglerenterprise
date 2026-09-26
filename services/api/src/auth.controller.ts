import { Body, Controller, Get, NotFoundException, Param, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT } from 'jose';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { Response } from 'express';
import { AuthProvidersService } from './auth-providers';
import { PrismaService } from './prisma.service';

class DevelopmentLoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() password!: string;
}

const testTenantId = '00000000-0000-4000-8000-000000000003';
const testSubject = 'local-test-operator';
const testEmail = 'tester@venuewrangler.invalid';
const testCapabilities = [
  'issue:report', 'issue:read', 'issue:evidence', 'issue:triage', 'issue:escalate',
  'issue:resolve', 'issue:verify', 'issue:close', 'operations:read',
  'operations:write', 'event:closeout', 'vendor:staffing', 'hospitality:order',
  'hospitality:fulfill', 'notification:read', 'venue:admin', 'tenant:admin',
];

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly providers: AuthProvidersService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  @Get('organizations/:organizationSlug/providers')
  providersForOrganization(@Param('organizationSlug') slug: string, @Res() response: Response) {
    const config = this.providers.forOrganization(slug);
    if (!config) throw new NotFoundException('No sign-in providers are configured for this organization.');
    response.setHeader('Cache-Control', 'no-store');
    return response.json(config);
  }

  @Post('development-login')
  async developmentLogin(@Body() input: DevelopmentLoginDto, @Res() response: Response) {
    if (this.config.get<string>('NODE_ENV') !== 'development' || this.config.get<string>('ENABLE_DEV_TEST_LOGIN') !== 'true') {
      throw new NotFoundException('Development login is unavailable.');
    }
    const password = this.config.get<string>('DEV_TEST_LOGIN_PASSWORD');
    const secret = this.config.get<string>('JWT_HS256_SECRET');
    if (!password || password.length < 16 || !secret || secret.length < 32) {
      throw new NotFoundException('Development login is not configured.');
    }
    const expected = createHash('sha256').update(password).digest();
    const supplied = createHash('sha256').update(input.password).digest();
    if (input.email.trim().toLowerCase() !== testEmail || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('The test login is invalid.');
    }
    const identity = { tenantId: testTenantId, subject: testSubject, capabilities: [], venueIds: [], eventIds: [], locationIds: [], assignableUserIds: [] };
    const fixture = await this.prisma.withTenant(identity, async (tx) => {
      const [organization, person, venues, events, locations, people] = await Promise.all([
        tx.organization.findUnique({ where: { id: testTenantId }, select: { slug: true, name: true } }),
        tx.person.findFirst({ where: { organizationId: testTenantId, externalSubject: testSubject, email: testEmail, active: true }, select: { id: true } }),
        tx.venue.findMany({ where: { organizationId: testTenantId, lifecycleState: 'ACTIVE' }, select: { id: true } }),
        tx.event.findMany({ where: { organizationId: testTenantId }, select: { id: true } }),
        tx.location.findMany({ where: { organizationId: testTenantId }, select: { id: true } }),
        tx.person.findMany({ where: { organizationId: testTenantId, active: true }, select: { externalSubject: true } }),
      ]);
      return { organization, person, venues, events, locations, people };
    });
    if (fixture.organization?.slug !== 'venue-test-lab' || !fixture.person || !fixture.venues.length || !fixture.events.length || !fixture.locations.length) {
      throw new NotFoundException('The verified test fixture has not been seeded.');
    }
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const accessToken = await new SignJWT({
      tenant_id: testTenantId,
      capabilities: testCapabilities,
      venue_ids: fixture.venues.map((venue) => venue.id),
      event_ids: fixture.events.map((event) => event.id),
      location_ids: fixture.locations.map((location) => location.id),
      assignable_user_ids: fixture.people.map((person) => person.externalSubject),
      test_fixture_verified: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(testSubject)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(secret));
    response.setHeader('Cache-Control', 'no-store');
    return response.json({ accessToken, expiresAt, organizationSlug: fixture.organization.slug, organizationName: fixture.organization.name, verificationStatus: 'verified-test-fixture' });
  }
}
