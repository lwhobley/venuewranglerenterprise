import { Body, Controller, ForbiddenException, Param, Post, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BeoUploadService } from './beo-upload.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

class ParseBeoUploadDto {
  @IsString() fileBase64!: string;
  @IsIn(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
  mimeType!: string;
}

class CommitLineItemDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceCents!: number;
  @IsOptional() @IsString() category?: string;
}

class CommitRowDto {
  @IsString() rowId!: string;
  @IsString() subVenueId!: string;
  @IsOptional() @IsString() beoNumber?: string | null;
  @IsString() hostName!: string;
  @IsOptional() @IsInt() @Min(0) guestCount?: number | null;
  @IsOptional() @IsString() serviceStart?: string | null;
  @IsOptional() @IsString() serviceEnd?: string | null;
  @IsOptional() @IsString() specialInstructions?: string | null;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CommitLineItemDto)
  lineItems!: CommitLineItemDto[];
}

class CommitBeoUploadDto {
  @IsOptional() @IsString() documentTitle?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CommitRowDto)
  rows!: CommitRowDto[];
}

/**
 * Uploading the BEO document a caterer sends, rather than keying it in.
 *
 * `parse` proposes; `commit` writes. They are separate calls because the step
 * between them is a manager confirming which suite each row belongs to.
 */
@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/events/:eventId/beo-upload')
@RequireSubscription()
export class BeoUploadController {
  constructor(private readonly service: BeoUploadService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Manager access is required to import BEOs.');
    }
  }

  /** Reads the upload and proposes rows. Writes nothing. */
  @Post('parse')
  async parse(@VenueScope() scope: Scope, @Param('eventId') eventId: string, @Body() body: ParseBeoUploadDto) {
    this.assertManager(scope);
    return this.service.parse(scope.venueId, eventId, body);
  }

  /** Creates the sales BEO and its suite orders from the reviewed rows. */
  @Post('commit')
  async commit(@VenueScope() scope: Scope, @Param('eventId') eventId: string, @Body() body: CommitBeoUploadDto) {
    this.assertManager(scope);
    return this.service.commit(
      scope.venueId,
      eventId,
      { profileId: scope.profileId },
      {
        documentTitle: body.documentTitle ?? '',
        rows: body.rows.map((row) => ({
          rowId: row.rowId,
          subVenueId: row.subVenueId,
          beoNumber: row.beoNumber ?? null,
          hostName: row.hostName,
          guestCount: row.guestCount ?? null,
          serviceStart: row.serviceStart ?? null,
          serviceEnd: row.serviceEnd ?? null,
          specialInstructions: row.specialInstructions ?? null,
          lineItems: row.lineItems.map((item) => ({
            code: item.code ?? '',
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            category: item.category ?? 'other',
          })),
        })),
      },
    );
  }
}
