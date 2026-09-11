import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { getClientIp } from '../../common/http';
import { hashInviteToken } from '../../common/invite-token';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { sanitizeForEmail } from '../../common/sanitize-email-text';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';

const INVITE_CHECK_LIMIT_MAX = 10;
const INVITE_CHECK_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const INVITE_EMAIL_LIMIT_MAX = 3;
const INVITE_EMAIL_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const JOIN_REQUEST_LIMIT_MAX = 5;
const JOIN_REQUEST_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const APPROVE_LIMIT_MAX = 60;
const APPROVE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function normalisedPhone(raw: string): string {
  return raw.replace(/[\s\-().+]/g, '');
}

class InviteCheckDto {
  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}

class JoinRequestDto {
  @IsString()
  venueId!: string;

  @IsString()
  code!: string;
}

class ReviewDecisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

@SkipVenueScope()
@Controller('v1/workforce')
export class WorkforceController {
  private readonly logger = new Logger(WorkforceController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public: invite check ──────────────────────────────────────────────────

  @Public()
  @Post('invite-check')
  async inviteCheck(@Req() req: Request, @Body() body: InviteCheckDto) {
    await assertWithinSharedRateLimit(this.prisma, `invite-check:ip:${getClientIp(req)}`, INVITE_CHECK_LIMIT_MAX, INVITE_CHECK_LIMIT_WINDOW_MS);

    const email = body.email?.trim().toLowerCase();
    const phone = body.phone ? normalisedPhone(body.phone) : undefined;

    if (!email && !phone) {
      throw new BadRequestException('Provide an email address or mobile number.');
    }
    const contactHash = createHash('sha256').update(email ?? phone!).digest('hex');
    await assertWithinSharedRateLimit(
      this.prisma,
      `invite-check:contact:${contactHash}`,
      INVITE_EMAIL_LIMIT_MAX,
      INVITE_EMAIL_LIMIT_WINDOW_MS,
    );

    // Phone-only contacts never get emailed. Do not look up the roster —
    // presence would otherwise leak through distinct statuses or timing.
    if (!email) {
      return this.opaqueInviteCheckResult();
    }

    // The plaintext token is only needed when minting a new invite. Existing
    // links remain valid: rotating their hash here would let anyone who knows
    // an address invalidate that address's emailed link.
    const freshToken = randomBytes(18).toString('base64url');
    const tokenHash = hashInviteToken(freshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite-check:${email}`}))`;

      const redeemable = await tx.invite.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, usedBy: null, expiresAt: { gt: new Date() } },
        include: { venue: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });

      if (redeemable) {
        return { venueName: redeemable.venue.name, jobTitle: redeemable.jobTitle, emailSent: false } as const;
      }

      const unclaimedProfile = await tx.profile.findFirst({
        where: { userId: null, venueId: { not: null }, email: { equals: email, mode: 'insensitive' } },
        include: { venue: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (!unclaimedProfile || !unclaimedProfile.venue) {
        return null;
      }

      const created = await tx.invite.create({
        data: {
          venueId: unclaimedProfile.venueId!,
          email,
          tokenHash,
          role: unclaimedProfile.role,
          jobTitle: unclaimedProfile.jobTitle,
          createdBy: unclaimedProfile.id,
          expiresAt: newExpiresAt,
        },
        include: { venue: { select: { name: true } } },
      });
      return { venueName: created.venue.name, jobTitle: created.jobTitle, emailSent: true } as const;
    });

    if (!outcome) {
      return this.opaqueInviteCheckResult();
    }

    const appUrl = (this.config.get<string>('APP_WEB_URL') ?? 'https://venuewrangler.com').replace(/\/+$/, '');
    // A URL fragment (not a query string) so the token never reaches
    // server/CDN access logs — fragments aren't sent in the HTTP request at
    // all. site/join/index.html reads from the fragment first.
    const signupUrl = `${appUrl}/join#invite=${encodeURIComponent(freshToken)}`;
    const venueName = sanitizeForEmail(outcome.venueName);
    // Fire-and-forget: awaiting the send here would (a) make `found`
    // responses measurably slower than `not_found` ones (a timing side
    // channel for the enumeration check above) and (b) turn a transient
    // email-provider outage into a 500 that still confirms "found" via the
    // error shape. The invite itself is already durable in the DB, so a
    // failed send leaves the newly-created invite available for recovery.
    if (outcome.emailSent) {
      void this.email
        .sendOrThrow({
          to: email,
          subject: `Create your Venue Wrangler account for ${venueName}`,
          text:
            `Your email address has been invited to join ${venueName} on Venue Wrangler as ${outcome.jobTitle}.\n\n` +
            `Create your account using this secure link:\n${signupUrl}\n\n` +
            `Create your account with this invited email address and you will automatically join ${venueName}.\n\n` +
            `This link expires on ${newExpiresAt.toLocaleDateString('en-US')}. If you did not expect this invitation, you can ignore this email.\n\n` +
            `Questions? support@venuewrangler.com\n\n` +
            `— The Venue Wrangler Team`,
        })
        .catch((err: unknown) => {
          this.logger.error(`Invite-check email failed for a venue invite: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    return this.opaqueInviteCheckResult();
  }

  private opaqueInviteCheckResult() {
    return { status: 'ok' as const };
  }

  // ─── Public: venue search (Retired: join requests decommissioned) ──────────

  @Public()
  @Get('venues/search')
  async searchVenues(@Req() req: Request, @Query('q') q: unknown) {
    await assertWithinSharedRateLimit(this.prisma, `venue-search:ip:${getClientIp(req)}`, INVITE_CHECK_LIMIT_MAX, INVITE_CHECK_LIMIT_WINDOW_MS);

    if (q !== undefined && typeof q !== 'string') {
      throw new BadRequestException('Search query must be a string.');
    }
    const term = (q ?? '').trim();
    if (term.length > 120) {
      throw new BadRequestException('Search query must be 120 characters or fewer.');
    }
    // Join requests have been decommissioned; unauthenticated venue enumeration is disabled.
    return { venues: [] };
  }

  // ─── Authenticated: user's own join requests (Disabled: users added by management) ─────

  @Get('join-requests')
  async listMyJoinRequests(@CurrentUser() _user: AuthUser) {
    return { requests: [] };
  }

  @Post('join-request')
  async submitJoinRequest(@Req() _req: Request, @CurrentUser() _user: AuthUser, @Body() _body: JoinRequestDto) {
    throw new BadRequestException('Join requests are disabled. All users must be added directly by venue management.');
  }

  @Delete('join-request/:id')
  async cancelJoinRequest(@CurrentUser() _user: AuthUser, @Param('id') _id: string) {
    return { ok: true };
  }

  // ─── Manager: review join requests (Disabled: users added by management) ────

  @Get('manager/join-requests')
  async listManagerJoinRequests(@CurrentUser() _user: AuthUser) {
    return { requests: [] };
  }

  @Post('manager/join-request/:id/approve')
  async approveJoinRequest(
    @Req() _req: Request,
    @CurrentUser() _user: AuthUser,
    @Param('id') _id: string,
  ) {
    throw new BadRequestException('Join requests are disabled. All users must be added directly by venue management.');
  }

  @Post('manager/join-request/:id/reject')
  async rejectJoinRequest(
    @Req() _req: Request,
    @CurrentUser() _user: AuthUser,
    @Param('id') _id: string,
    @Body() _body: ReviewDecisionDto,
  ) {
    throw new BadRequestException('Join requests are disabled. All users must be added directly by venue management.');
  }

  // ─── Manager: join request detail (Disabled) ──────────────────────────────

  @Get('manager/join-request/:id')
  async getJoinRequestDetail(@CurrentUser() _user: AuthUser, @Param('id') _id: string) {
    throw new NotFoundException('Join requests are disabled.');
  }

  private emailJoinRequestDecision(id: string, decision: 'approved' | 'rejected', note?: string | null) {
    void this.emailJoinRequestDecisionInBackground(id, decision, note).catch((error) => {
      this.logger.error(
        `Join-request decision email failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  private async emailJoinRequestDecisionInBackground(id: string, decision: 'approved' | 'rejected', note?: string | null) {
    const request = await this.prisma.workplaceJoinRequest.findUnique({
      where: { id },
      include: {
        venue: { select: { name: true } },
        user: {
          select: {
            email: true,
            profiles: {
              where: { venueId: null },
              select: { fullName: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!request) return;
    const to = request.user.email;
    if (!to) return;
    const name = request.user.profiles?.[0]?.fullName ?? 'there';
    const statusText = decision === 'approved' ? 'Approved' : 'Rejected';
    void this.email.send({
      to,
      subject: `Your request to join ${request.venue.name} was ${statusText}`,
      text:
        `Hi ${name},\n\n` +
        `Your request to join ${request.venue.name} has been ${statusText.toLowerCase()} by a manager.\n\n` +
        `Request Details\n` +
        `Detail\tInfo\n` +
        `Venue\t${request.venue.name}\n` +
        `Status\t${statusText}\n` +
        (note ? `Manager Note\t${note}\n\n` : '\n') +
        (decision === 'approved'
          ? `You can now log in to the Venue Wrangler app to access your team dashboard and start viewing your shifts.\n\n`
          : `Please reach out to your venue manager directly if you have any questions or require further assistance.\n\n`) +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });
  }

}
