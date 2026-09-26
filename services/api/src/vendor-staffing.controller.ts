import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateVendorStaffingRequestDto, ResolveVendorStaffingRequestDto, RespondVendorStaffingRequestDto } from './vendor-staffing.dto';
import { VendorStaffingService } from './vendor-staffing.service';

@Controller('v1/events/:eventId/vendor-staffing')
@UseGuards(JwtIdentityGuard)
@ApiTags('Vendor staffing')
@ApiBearerAuth()
export class VendorStaffingController {
  constructor(private readonly vendors: VendorStaffingService) {}

  @Get() list(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.vendors.list(req.identity, eventId);
  }

  @Post('escalate-overdue') escalateOverdue(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Headers('idempotency-key') key: string) {
    return this.vendors.escalateOverdue(req.identity, eventId, this.key(key));
  }

  @Post() create(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: CreateVendorStaffingRequestDto, @Headers('idempotency-key') key: string) {
    return this.vendors.create(req.identity, eventId, dto, this.key(key));
  }

  @Post(':requestId/respond') respond(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('requestId', new ParseUUIDPipe()) requestId: string, @Body() dto: RespondVendorStaffingRequestDto, @Headers('idempotency-key') key: string) {
    return this.vendors.respond(req.identity, eventId, requestId, dto, this.key(key));
  }

  @Post(':requestId/cancel') cancel(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('requestId', new ParseUUIDPipe()) requestId: string, @Body() dto: ResolveVendorStaffingRequestDto, @Headers('idempotency-key') key: string) {
    return this.vendors.resolve(req.identity, eventId, requestId, 'CANCELLED', dto.reason, this.key(key));
  }

  @Post(':requestId/fulfill') fulfill(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('requestId', new ParseUUIDPipe()) requestId: string, @Body() dto: ResolveVendorStaffingRequestDto, @Headers('idempotency-key') key: string) {
    return this.vendors.resolve(req.identity, eventId, requestId, 'FULFILLED', dto.reason, this.key(key));
  }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new BadRequestException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
